package process

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/shirou/gopsutil/v3/process"
)

type Process struct {
	ID           string
	Name         string
	Path         string
	Cmd          *exec.Cmd
	RecoveredPID int // Kurtarılan süreçlerin PID'sini tutmak için
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

	// YENİ: Linter'ın haklı olarak uyardığı hata kontrolünü geri ekliyoruz.
	if err := scanner.Err(); err != nil {
		fmt.Fprintf(m.output, "[%s] [SYSTEM LOG ERROR] %v\n", projectName, err)
	}
}

// YENİ: Recover fonksiyonu diskteki PID dosyasını okuyup süreci hayata döndürür
func (m *Manager) Recover(id, name, path string) bool {
	pidFile := filepath.Join(path, ".diony_hub.pid")
	data, err := os.ReadFile(pidFile)
	if err != nil {
		return false
	}

	pidStr := strings.TrimSpace(string(data))
	pid, err := strconv.Atoi(pidStr)
	if err != nil {
		return false
	}

	// İşletim sisteminde bu PID hala yaşıyor mu?
	exists, err := process.PidExists(int32(pid))
	if err != nil || !exists {
		os.Remove(pidFile) // Ölmüşse çöp dosyayı sil
		return false
	}

	m.mu.Lock()
	m.processes[id] = &Process{
		ID:           id,
		Name:         name,
		Path:         path,
		RecoveredPID: pid,
		Running:      true,
	}
	m.mu.Unlock()

	fmt.Fprintf(m.output, "[%s] 🔄 \x1b[36mRecovered orphaned process (PID: %d)\x1b[0m\n", name, pid)

	// Kurtarılan sürecin durumunu izleyen mini-watchdog
	go func() {
		for {
			time.Sleep(2 * time.Second)
			alive, _ := process.PidExists(int32(pid))
			if !alive {
				m.mu.Lock()
				if p, ok := m.processes[id]; ok && p.RecoveredPID == pid {
					p.Running = false
				}
				m.mu.Unlock()
				os.Remove(pidFile)
				fmt.Fprintf(m.output, "[%s] ⚪ Recovered process exited.\n", name)
				break
			}
		}
	}()

	return true
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
			title := fmt.Sprintf("%s - DionyHub", name)
			cmdArgs := append([]string{"/c", "start", title, "/WAIT", nameCmd}, args...)
			cmd = exec.Command("cmd", cmdArgs...)
			cmd.Dir = path
		} else {
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

	// YENİ: Süreç başlar başlamaz PID'yi klasörüne yazıyoruz (Mühürleme)
	pid := cmd.Process.Pid
	pidFile := filepath.Join(path, ".diony_hub.pid")
	os.WriteFile(pidFile, []byte(fmt.Sprint(pid)), 0644)

	m.mu.Lock()
	m.processes[id] = &Process{
		ID:           id,
		Name:         name,
		Path:         path,
		Cmd:          cmd,
		Running:      true,
		IntendedStop: false,
	}
	m.mu.Unlock()

	fmt.Fprintf(m.output, "[%s] 🚀 \x1b[32mProject started successfully (PID: %d).\x1b[0m\n", name, pid)

	go func() {
		cmd.Wait()

		m.mu.Lock()
		var intended bool
		if p, exists := m.processes[id]; exists {
			p.Running = false
			intended = p.IntendedStop
		}
		m.mu.Unlock()

		// Süreç durduğunda (ister hata, ister kasıtlı) mühür dosyasını siliyoruz
		os.Remove(pidFile)

		if autoRestart && !intended {
			fmt.Fprintf(m.output, "[%s] ⚠️ \x1b[33mProcess crashed! Restarting in 3 seconds...\x1b[0m\n", name)
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

	if !exists || !p.Running {
		return errors.New("process is not currently running")
	}

	// YENİ: Standart cmd yoksa (kurtarılmış süreçse), diske yazdığımız kurtarılan PID'yi kullan
	var pid int
	if p.Cmd != nil && p.Cmd.Process != nil {
		pid = p.Cmd.Process.Pid
	} else if p.RecoveredPID > 0 {
		pid = p.RecoveredPID
	} else {
		return errors.New("cannot determine process ID to kill")
	}

	fmt.Fprintf(m.output, "[%s] 🛑 Stop signal sent. Terminating process tree...\n", p.Name)

	var err error
	if runtime.GOOS == "windows" {
		killCmd := exec.Command("taskkill", "/T", "/F", "/PID", fmt.Sprint(pid))
		killCmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		err = killCmd.Run()

		windowTitle := fmt.Sprintf("%s - DionyHub*", p.Name)
		titleKillCmd := exec.Command("taskkill", "/F", "/FI", fmt.Sprintf("WINDOWTITLE eq %s", windowTitle))
		titleKillCmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		titleKillCmd.Run()
	} else {
		proc, _ := os.FindProcess(pid)
		if proc != nil {
			err = proc.Kill()
		}
	}

	m.mu.Lock()
	p.Running = false
	m.mu.Unlock()

	// Kapatma işlemi başarılıysa mühür dosyasını sil
	os.Remove(filepath.Join(p.Path, ".diony_hub.pid"))

	return err
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

	if !exists || !p.Running {
		return 0, 0
	}

	var pid int
	if p.Cmd != nil && p.Cmd.Process != nil {
		pid = p.Cmd.Process.Pid
	} else {
		pid = p.RecoveredPID
	}

	proc, err := process.NewProcess(int32(pid))
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
