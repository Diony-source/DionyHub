// Package process handles the lifecycle, execution, and monitoring of background applications.
package process

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"sync"
)

type Process struct {
	ID      string
	Name    string
	Cmd     *exec.Cmd
	Running bool
}

type Manager struct {
	mu        sync.RWMutex
	processes map[string]*Process
}

func NewManager() *Manager {
	return &Manager{
		processes: make(map[string]*Process),
	}
}

// Start initiates a process. If interactive is true, it spawns a new visible terminal (Windows only).
func (m *Manager) Start(id, name, workDir string, interactive bool, commandName string, args ...string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if p, exists := m.processes[id]; exists && p.Running {
		return fmt.Errorf("process '%s' is already running", name)
	}

	var cmd *exec.Cmd

	if interactive && runtime.GOOS == "windows" {
		// YENİ: Windows'ta yeni bir komut istemi penceresi açar ("DionyHub - ProjeAdı" başlığıyla)
		title := fmt.Sprintf(`"DionyHub - %s"`, name)
		fullArgs := []string{"/C", "start", title, commandName}
		fullArgs = append(fullArgs, args...)

		cmd = exec.Command("cmd", fullArgs...)
	} else {
		// Arka planda (sessiz) çalışan servisler için
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

	// Etkileşimli (yeni pencerede açılan) uygulamalar işletim sisteminden kopuk çalıştığı için
	// onların kapanmasını beklemek tutarlı olmaz. Sadece arka plan uygulamalarını izliyoruz.
	if !interactive {
		go m.monitor(id)
	} else {
		// Yeni pencere açıldığı an bizim için işlem tamamdır.
		m.processes[id].Running = false
	}

	return nil
}

func (m *Manager) Stop(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	p, exists := m.processes[id]
	if !exists || !p.Running {
		return fmt.Errorf("process with ID '%s' is not currently running", id)
	}

	var err error
	if runtime.GOOS == "windows" {
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
