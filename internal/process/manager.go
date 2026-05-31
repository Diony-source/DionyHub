package process

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
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
	IntendedStop bool // YENİ: Kullanıcı bilerek mi durdurdu? (Watchdog iptali için)
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

// YENİ: autoRestart parametresi eklendi
func (m *Manager) Start(id, name, path string, interactive bool, autoRestart bool, globalEnvs []string, nameCmd string, args ...string) error {
	m.mu.Lock()
	if p, exists := m.processes[id]; exists && p.Running {
		m.mu.Unlock()
		return errors.New("process is already running")
	}
	m.mu.Unlock()

	var cmd *exec.Cmd
	if interactive {
		cmdArgs := append([]string{"/c", "start", nameCmd}, args...)
		cmd = exec.Command("cmd", cmdArgs...)
		cmd.Dir = path
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
	}

	cmd.Env = os.Environ()
	cmd.Env = append(cmd.Env, globalEnvs...)

	if !interactive {
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	}

	if err := cmd.Start(); err != nil {
		return err
	}

	m.mu.Lock()
	m.processes[id] = &Process{
		ID:           id,
		Name:         name,
		Cmd:          cmd,
		Running:      true,
		IntendedStop: false, // İlk açılışta kasıtlı durdurma false'tur
	}
	m.mu.Unlock()

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

		// Eğer otomatik başlatma açıksa ve kullanıcı KENDİSİ durdurmamışsa (Çökmüşse)
		if autoRestart && !intended {
			fmt.Fprintf(m.output, "[%s] [WATCHDOG] ⚠️ Process crashed or exited unexpectedly! Restarting in 3 seconds...\n", name)
			time.Sleep(3 * time.Second)

			// 3 saniye sonra hala mevcut mu kontrol et (belki o sırada silindi)
			m.mu.RLock()
			stillExists := false
			if p, exists := m.processes[id]; exists && !p.Running {
				stillExists = true
			}
			m.mu.RUnlock()

			if stillExists {
				fmt.Fprintf(m.output, "[%s] [WATCHDOG] 🛡️ Initiating auto-recovery...\n", name)
				m.Start(id, name, path, interactive, autoRestart, globalEnvs, nameCmd, args...)
			}
		}
	}()

	return nil
}

func (m *Manager) Stop(id string) error {
	m.mu.Lock()
	p, exists := m.processes[id]
	if exists {
		// Watchdog'a haber ver: "Bu bir çökme değil, kullanıcı kendisi durdurdu. Yeniden başlatma!"
		p.IntendedStop = true
	}
	m.mu.Unlock()

	if !exists || !p.Running || p.Cmd == nil || p.Cmd.Process == nil {
		return errors.New("process is not currently running")
	}

	err := p.Cmd.Process.Kill()
	if err != nil {
		return err
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
