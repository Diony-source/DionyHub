// Package process handles the lifecycle, execution, and monitoring of background applications.
package process

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"sync"
)

// Process represents a single background application managed by DionyHub.
type Process struct {
	ID      string
	Name    string
	Cmd     *exec.Cmd
	Running bool
}

// Manager holds the state of all running processes.
type Manager struct {
	mu        sync.RWMutex
	processes map[string]*Process
}

// NewManager initializes and returns a new thread-safe process manager.
func NewManager() *Manager {
	return &Manager{
		processes: make(map[string]*Process),
	}
}

// Start initiates a new process. If interactive, it natively spawns a new visible Windows terminal.
func (m *Manager) Start(id, name, workDir string, interactive bool, commandName string, args ...string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if p, exists := m.processes[id]; exists && p.Running {
		return fmt.Errorf("process '%s' is already running", name)
	}

	var cmd *exec.Cmd

	if interactive && runtime.GOOS == "windows" {
		// KRİTİK ÇÖZÜM:
		// /WAIT : cmd.exe'nin arka planda kapanmasını engeller, böylece PID'yi takip edebiliriz.
		// ""    : Boş başlık, Windows'un tırnak işareti (quote parsing) krizini çözer.
		fullArgs := []string{"/C", "start", "/WAIT", "", commandName}
		fullArgs = append(fullArgs, args...)

		cmd = exec.Command("cmd", fullArgs...)
	} else {
		cmd = exec.Command(commandName, args...)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
	}

	cmd.Dir = workDir

	err := cmd.Start()
	if err != nil {
		return fmt.Errorf("failed to start process '%s': %w", name, err)
	}

	m.processes[id] = &Process{
		ID:      id,
		Name:    name,
		Cmd:     cmd,
		Running: true,
	}

	// /WAIT parametresi sayesinde etkileşimli pencereler de dahil tüm süreçleri takip edebiliriz.
	go m.monitor(id)

	return nil
}

// Stop gracefully terminates a running background process AND its children.
func (m *Manager) Stop(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	p, exists := m.processes[id]
	if !exists || !p.Running {
		return fmt.Errorf("process with ID '%s' is not currently running", id)
	}

	var err error
	if runtime.GOOS == "windows" {
		// Taskkill /T (Tree) parametresi cmd.exe'yi, start komutunu ve içindeki uygulamayı kökten temizler.
		killCmd := exec.Command("taskkill", "/T", "/F", "/PID", fmt.Sprint(p.Cmd.Process.Pid))
		err = killCmd.Run()
	} else {
		err = p.Cmd.Process.Kill()
	}

	if err != nil {
		return fmt.Errorf("failed to stop process tree '%s': %w", p.Name, err)
	}

	p.Running = false
	return nil
}

// monitor waits for the OS process to finish and updates the internal state.
func (m *Manager) monitor(id string) {
	m.mu.RLock()
	p, exists := m.processes[id]
	m.mu.RUnlock()

	if !exists {
		return
	}

	err := p.Cmd.Wait()

	m.mu.Lock()
	defer m.mu.Unlock()

	p.Running = false
	if err != nil {
		fmt.Printf("[MONITOR] Process '%s' exited/stopped.\n", p.Name)
	} else {
		fmt.Printf("[MONITOR] Process '%s' finished execution successfully.\n", p.Name)
	}
}
