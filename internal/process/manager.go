package process

import (
	"archive/zip"
	"encoding/json"
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

type RotatingLogWriter struct {
	mu       sync.Mutex
	logPath  string
	maxBytes int64
	file     *os.File
	size     int64
}

func NewRotatingLogWriter(logPath string, maxMB int) (*RotatingLogWriter, error) {
	rlw := &RotatingLogWriter{
		logPath:  logPath,
		maxBytes: int64(maxMB) * 1024 * 1024,
	}
	err := rlw.open()
	return rlw, err
}

func (w *RotatingLogWriter) open() error {
	info, err := os.Stat(w.logPath)
	if err == nil {
		w.size = info.Size()
	}
	f, err := os.OpenFile(w.logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	w.file = f
	return nil
}

func (w *RotatingLogWriter) Write(p []byte) (n int, err error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.size+int64(len(p)) > w.maxBytes {
		w.rotate()
	}

	if w.file != nil {
		n, err = w.file.Write(p)
		w.size += int64(n)
		return n, err
	}
	return 0, errors.New("log file is not open")
}

func (w *RotatingLogWriter) rotate() {
	if w.file != nil {
		w.file.Close()
	}

	timestamp := time.Now().Format("2006-01-02_15-04-05")
	archivePath := w.logPath + "." + timestamp + ".log"
	os.Rename(w.logPath, archivePath)

	w.size = 0
	w.open()

	go func(src string) {
		zipPath := src + ".zip"
		zipFile, err := os.Create(zipPath)
		if err != nil {
			return
		}
		defer zipFile.Close()

		archive := zip.NewWriter(zipFile)
		defer archive.Close()

		writer, err := archive.Create(filepath.Base(src))
		if err == nil {
			f, err := os.Open(src)
			if err == nil {
				io.Copy(writer, f)
				f.Close()
				os.Remove(src)
			}
		}
	}(archivePath)
}

func (w *RotatingLogWriter) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.file != nil {
		return w.file.Close()
	}
	return nil
}

type Process struct {
	ID           string
	Name         string
	Path         string
	Cmd          *exec.Cmd
	Stdin        io.WriteCloser
	LogWriter    *RotatingLogWriter
	RecoveredPID int
	Running      bool
	IntendedStop bool
	StartTime    time.Time // YENİ: Uptime hesaplaması için başlangıç anı
}

type Manager struct {
	mu        sync.RWMutex
	processes map[string]*Process
	console   io.Writer
	ws        io.Writer
}

func NewManager(console io.Writer, ws io.Writer) *Manager {
	return &Manager{
		processes: make(map[string]*Process),
		console:   console,
		ws:        ws,
	}
}

func (m *Manager) sysLog(id, name, message string) {
	fmt.Fprintf(m.console, "\x1b[90m[%s]\x1b[0m %s\n", name, message)

	type WSLog struct {
		ID   string `json:"id"`
		Data string `json:"data"`
	}

	wsMsgProj, _ := json.Marshal(WSLog{ID: id, Data: message + "\n"})
	m.ws.Write(wsMsgProj)

	sysAuditMsg := fmt.Sprintf("\x1b[36m[AUDIT]\x1b[0m \x1b[33m%s\x1b[0m -> %s\n", name, message)
	wsMsgSys, _ := json.Marshal(WSLog{ID: "system", Data: sysAuditMsg})
	m.ws.Write(wsMsgSys)
}

func (m *Manager) prefixLogger(id, name string, r io.Reader, logWriter io.Writer) {
	buf := make([]byte, 4096)
	needsPrefix := true

	type WSLog struct {
		ID   string `json:"id"`
		Data string `json:"data"`
	}

	for {
		n, err := r.Read(buf)
		if n > 0 {
			chunk := buf[:n]

			wsMsg, _ := json.Marshal(WSLog{ID: id, Data: string(chunk)})
			m.ws.Write(wsMsg)

			if logWriter != nil {
				logWriter.Write(chunk)
			}

			var out strings.Builder
			for i := 0; i < n; i++ {
				if needsPrefix {
					out.WriteString(fmt.Sprintf("\x1b[90m[%s]\x1b[0m ", name))
					needsPrefix = false
				}
				b := chunk[i]
				out.WriteByte(b)
				if b == '\n' {
					needsPrefix = true
				}
			}
			fmt.Fprint(m.console, out.String())
		}

		if err != nil {
			if err != io.EOF && !errors.Is(err, os.ErrClosed) && !strings.Contains(err.Error(), "file already closed") {
				m.sysLog(id, name, fmt.Sprintf("\x1b[31m[SYSTEM LOG ERROR] %v\x1b[0m", err))
			}
			break
		}
	}
}

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

	exists, err := process.PidExists(int32(pid))
	if err != nil || !exists {
		os.Remove(pidFile)
		return false
	}

	m.mu.Lock()
	m.processes[id] = &Process{
		ID:           id,
		Name:         name,
		Path:         path,
		RecoveredPID: pid,
		Running:      true,
		StartTime:    time.Now(), // Kurtarıldığı anı referans alıyoruz
	}
	m.mu.Unlock()

	m.sysLog(id, name, fmt.Sprintf("🔄 \x1b[36mRecovered orphaned process (PID: %d)\x1b[0m", pid))

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
				m.sysLog(id, name, "⚪ Recovered process exited.")
				break
			}
		}
	}()

	return true
}

func (m *Manager) WriteInput(id string, input string) error {
	m.mu.RLock()
	p, exists := m.processes[id]
	m.mu.RUnlock()

	if !exists || !p.Running {
		return errors.New("process is not running")
	}

	if p.Stdin == nil {
		return errors.New("this process does not accept internal terminal inputs")
	}

	if p.LogWriter != nil {
		p.LogWriter.Write([]byte(input))
	}

	_, err := io.WriteString(p.Stdin, input)
	return err
}

func (m *Manager) Start(id, name, path string, interactive bool, autoRestart bool, globalEnvs []string, nameCmd string, args ...string) error {
	m.mu.Lock()
	if p, exists := m.processes[id]; exists && p.Running {
		m.mu.Unlock()
		return errors.New("process is already running")
	}
	m.mu.Unlock()

	var cmd *exec.Cmd
	var stdinPipe io.WriteCloser
	var logWriter *RotatingLogWriter

	if !interactive {
		logDir := filepath.Join(path, "logs")
		os.MkdirAll(logDir, 0755)
		logPath := filepath.Join(logDir, "dionyhub.log")

		logWriter, _ = NewRotatingLogWriter(logPath, 10)
	}

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
			go m.prefixLogger(id, name, stdout, logWriter)
		}

		stderr, err := cmd.StderrPipe()
		if err == nil {
			go m.prefixLogger(id, name, stderr, logWriter)
		}

		stdinPipe, _ = cmd.StdinPipe()
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	}

	cmd.Env = os.Environ()
	cmd.Env = append(cmd.Env, globalEnvs...)

	if err := cmd.Start(); err != nil {
		if logWriter != nil {
			logWriter.Close()
		}
		return err
	}

	pid := cmd.Process.Pid
	pidFile := filepath.Join(path, ".diony_hub.pid")
	os.WriteFile(pidFile, []byte(fmt.Sprint(pid)), 0644)

	m.mu.Lock()
	m.processes[id] = &Process{
		ID:           id,
		Name:         name,
		Path:         path,
		Cmd:          cmd,
		Stdin:        stdinPipe,
		LogWriter:    logWriter,
		Running:      true,
		IntendedStop: false,
		StartTime:    time.Now(), // YENİ: Başlangıç zamanı kaydedildi
	}
	m.mu.Unlock()

	m.sysLog(id, name, fmt.Sprintf("🚀 \x1b[32mProject started successfully (PID: %d).\x1b[0m", pid))

	go func() {
		cmd.Wait()

		m.mu.Lock()
		var intended bool
		if p, exists := m.processes[id]; exists {
			p.Running = false
			intended = p.IntendedStop

			if p.LogWriter != nil {
				p.LogWriter.Close()
			}
		}
		m.mu.Unlock()

		os.Remove(pidFile)

		if autoRestart && !intended {
			m.sysLog(id, name, "⚠️ \x1b[33mProcess crashed! Restarting in 3 seconds...\x1b[0m")
			time.Sleep(3 * time.Second)

			m.mu.RLock()
			stillExists := false
			if p, exists := m.processes[id]; exists && !p.Running {
				stillExists = true
			}
			m.mu.RUnlock()

			if stillExists {
				m.sysLog(id, name, "🛡️ Initiating auto-recovery...")
				m.Start(id, name, path, interactive, autoRestart, globalEnvs, nameCmd, args...)
			}
		} else if !intended {
			m.sysLog(id, name, "⚪ Process exited normally.")
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

	var pid int
	if p.Cmd != nil && p.Cmd.Process != nil {
		pid = p.Cmd.Process.Pid
	} else if p.RecoveredPID > 0 {
		pid = p.RecoveredPID
	} else {
		return errors.New("cannot determine process ID to kill")
	}

	m.sysLog(id, p.Name, "🛑 Stop signal sent. Terminating process tree...")

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
	if p.LogWriter != nil {
		p.LogWriter.Close()
	}
	m.mu.Unlock()

	os.Remove(filepath.Join(p.Path, ".diony_hub.pid"))

	return err
}

func (m *Manager) IsRunning(id string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	p, exists := m.processes[id]
	return exists && p.Running
}

// YENİ: Uptime verisi eklendi
func (m *Manager) GetStats(id string) (cpu float64, ram float64, uptime int64) {
	m.mu.RLock()
	p, exists := m.processes[id]
	m.mu.RUnlock()

	if !exists || !p.Running {
		return 0, 0, 0
	}

	var pid int
	if p.Cmd != nil && p.Cmd.Process != nil {
		pid = p.Cmd.Process.Pid
	} else {
		pid = p.RecoveredPID
	}

	proc, err := process.NewProcess(int32(pid))
	if err != nil {
		return 0, 0, int64(time.Since(p.StartTime).Seconds())
	}

	cpuPercent, _ := proc.CPUPercent()
	memInfo, _ := proc.MemoryInfo()

	if memInfo != nil {
		ram = float64(memInfo.RSS) / (1024 * 1024)
	}

	return cpuPercent, ram, int64(time.Since(p.StartTime).Seconds())
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
