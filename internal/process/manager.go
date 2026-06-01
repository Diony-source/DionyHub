package process

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"runtime"
	"sync"
	"syscall"
	"time"

	"github.com/shirou/gopsutil/v3/process"
)

type Process struct {
	ID           string
	Name         string
	Cmd          *exec.Cmd
	Running      bool
	IntendedStop bool
}

type Manager struct {
	mu        sync.RWMutex
	processes map[string]*Process
	output    io.Writer
}

func NewManager(output io.Writer) *Manager {
	return &Manager{
		processes: make(map[string]*Process),
		output:    output,
	}
}

func (m *Manager) prefixLogger(projectName string, r io.Reader) {
	scanner := bufio.NewScanner(r)
	throttle := time.NewTicker(10 * time.Millisecond)
	defer throttle.Stop()

	for scanner.Scan() {
		<-throttle.C
		fmt.Fprintf(m.output, "[%s] %s\n", projectName, scanner.Text())
	}

	if err := scanner.Err(); err != nil {
		fmt.Fprintf(m.output, "[%s] [SYSTEM LOG ERROR] %v\n", projectName, err)
	}
}

func (m *Manager) Start(id, name, path string, interactive bool, autoRestart bool, globalEnvs []string, nameCmd string, args ...string) error {
	m.mu.Lock()
	if p, exists := m.processes[id]; exists && p.Running {
		m.mu.Unlock()
		return errors.New("process is already running")
	}
	m.mu.Unlock()

	var cmd *exec.Cmd
	if interactive {
		if runtime.GOOS == "windows" {
			// KUSURSUZ ÇÖZÜM: 'start /WAIT' kullanıyoruz!
			// /WAIT: Pencere kapanana kadar beklemesini sağlar (Anında stopped olmasını engeller).
			// name: Pencerenin başlığına (Title) projenin adını yazar.
			cmdArgs := append([]string{"/c", "start", "/WAIT", name, nameCmd}, args...)
			cmd = exec.Command("cmd", cmdArgs...)
			cmd.Dir = path
		} else {
			// Mac/Linux Fallback
			cmd = exec.Command("x-terminal-emulator", append([]string{"-e", nameCmd}, args...)...)
			cmd.Dir = path
		}
	} else {
		cmd = exec.Command(nameCmd, args...)
		cmd.Dir = path

		stdout, err := cmd.StdoutPipe()
		if err == nil {
			go m.prefixLogger(name, stdout)
		}

		stderr, err := cmd.StderrPipe()
		if err == nil {
			go m.prefixLogger(name, stderr)
		}

		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	}

	cmd.Env = os.Environ()
	cmd.Env = append(cmd.Env, globalEnvs...)

	if err := cmd.Start(); err != nil {
		return err
	}

	m.mu.Lock()
	m.processes[id] = &Process{
		ID:           id,
		Name:         name,
		Cmd:          cmd,
		Running:      true,
		IntendedStop: false,
	}
	m.mu.Unlock()

	fmt.Fprintf(m.output, "[%s] 🚀 Project started successfully (PID: %d).\n", name, cmd.Process.Pid)

	// GÖZLEMCİ (WATCHDOG) GOROUTINE
	go func() {
		cmd.Wait()

		m.mu.Lock()
		var intended bool
		if p, exists := m.processes[id]; exists {
			p.Running = false
			intended = p.IntendedStop
		}
		m.mu.Unlock()

		if autoRestart && !intended {
			fmt.Fprintf(m.output, "[%s] ⚠️ Process crashed or exited unexpectedly! Restarting in 3 seconds...\n", name)
			time.Sleep(3 * time.Second)

			m.mu.RLock()
			stillExists := false
			if p, exists := m.processes[id]; exists && !p.Running {
				stillExists = true
			}
			m.mu.RUnlock()

			if stillExists {
				fmt.Fprintf(m.output, "[%s] 🛡️ Initiating auto-recovery...\n", name)
				m.Start(id, name, path, interactive, autoRestart, globalEnvs, nameCmd, args...)
			}
		} else if !intended {
			fmt.Fprintf(m.output, "[%s] ⚪ Process exited normally.\n", name)
		}
	}()

	return nil
}

func (m *Manager) Stop(id string) error {
	m.mu.Lock()
	p, exists := m.processes[id]
	if exists {
		p.IntendedStop = true
	}
	m.mu.Unlock()

	if !exists || !p.Running || p.Cmd == nil || p.Cmd.Process == nil {
		return errors.New("process is not currently running")
	}

	pid := p.Cmd.Process.Pid

	fmt.Fprintf(m.output, "[%s] 🛑 Stop signal sent. Terminating process tree...\n", p.Name)

	var err error
	if runtime.GOOS == "windows" {
		killCmd := exec.Command("taskkill", "/T", "/F", "/PID", fmt.Sprint(pid))
		killCmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		err = killCmd.Run()
	} else {
		err = p.Cmd.Process.Kill()
	}

	if err != nil {
		p.Cmd.Process.Kill()
	}

	m.mu.Lock()
	p.Running = false
	m.mu.Unlock()

	return nil
}

func (m *Manager) IsRunning(id string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	p, exists := m.processes[id]
	return exists && p.Running
}

func (m *Manager) GetStats(id string) (cpu float64, ram float64) {
	m.mu.RLock()
	p, exists := m.processes[id]
	m.mu.RUnlock()

	if !exists || !p.Running || p.Cmd == nil || p.Cmd.Process == nil {
		return 0, 0
	}

	proc, err := process.NewProcess(int32(p.Cmd.Process.Pid))
	if err != nil {
		return 0, 0
	}

	cpuPercent, _ := proc.CPUPercent()
	memInfo, _ := proc.MemoryInfo()

	if memInfo != nil {
		ram = float64(memInfo.RSS) / (1024 * 1024)
	}

	return cpuPercent, ram
}

func (m *Manager) StopAll() {
	m.mu.RLock()
	var ids []string
	for id, p := range m.processes {
		if p.Running {
			ids = append(ids, id)
		}
	}
	m.mu.RUnlock()

	for _, id := range ids {
		m.Stop(id)
	}
}
