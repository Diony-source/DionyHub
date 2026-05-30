// Package process handles the lifecycle of OS-level processes.
package process

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"sync"
	"syscall"

	"github.com/shirou/gopsutil/v3/process"
)

// Process holds the internal state and metadata of a running application.
type Process struct {
	ID      string
	Name    string
	Cmd     *exec.Cmd
	Running bool
}

// Manager orchestrates the execution, tracking, and termination of processes.
type Manager struct {
	mu        sync.RWMutex
	processes map[string]*Process
	output    io.Writer
}

// NewManager creates a new Process Manager linked to a specific log output destination.
func NewManager(output io.Writer) *Manager {
	return &Manager{
		processes: make(map[string]*Process),
		output:    output,
	}
}

// prefixLogger actively intercepts standard output/error, prepends the project name, and writes it.
func (m *Manager) prefixLogger(projectName string, r io.Reader) {
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		fmt.Fprintf(m.output, "[%s] %s\n", projectName, scanner.Text())
	}

	// YENİ: Linter uyarısını çözen ve okuma sırasında oluşan olası hataları yakalayan güvenlik kontrolü
	if err := scanner.Err(); err != nil {
		fmt.Fprintf(m.output, "[%s] [SYSTEM LOG ERROR] %v\n", projectName, err)
	}
}

// Start spawns a new OS process. If interactive, it attempts to spawn a visible terminal.
func (m *Manager) Start(id, name, path string, interactive bool, nameCmd string, args ...string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if p, exists := m.processes[id]; exists && p.Running {
		return errors.New("process is already running")
	}

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

	if !interactive {
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	}

	if err := cmd.Start(); err != nil {
		return err
	}

	m.processes[id] = &Process{
		ID:      id,
		Name:    name,
		Cmd:     cmd,
		Running: true,
	}

	go func() {
		cmd.Wait()
		m.mu.Lock()
		if p, exists := m.processes[id]; exists {
			p.Running = false
		}
		m.mu.Unlock()
	}()

	return nil
}

// Stop forcefully terminates a running process by its ID.
func (m *Manager) Stop(id string) error {
	m.mu.Lock()
	p, exists := m.processes[id]
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

// IsRunning checks the live status of a process.
func (m *Manager) IsRunning(id string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	p, exists := m.processes[id]
	return exists && p.Running
}

// GetStats returns the live CPU and RAM usage of the given process ID.
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
