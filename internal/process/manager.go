// Package process manager.go
// Handles the core lifecycle operations (Start, Stop, Write Input) of underlying OS processes.
package process

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/Diony-source/DionyHub/internal/logger"
)

// Process represents a running system command and its associated IO streams.
type Process struct {
	ID           string
	Name         string
	Path         string
	Cmd          *exec.Cmd
	Stdin        io.WriteCloser
	LogWriter    *logger.RotatingLogWriter
	RecoveredPID int
	Running      bool
	IntendedStop bool
	StartTime    time.Time
}

// Manager orchestrates process execution, routing their outputs to the correct WebSockets and log files.
type Manager struct {
	mu        sync.RWMutex
	processes map[string]*Process
	console   io.Writer
	ws        io.Writer
	sysLogger *logger.RotatingLogWriter

	OnExit func(id string, name string, uptime time.Duration, isCrash bool)
}

// NewManager initializes the process orchestrator and global system audit logger.
func NewManager(console io.Writer, ws io.Writer) *Manager {
	sysLogger, _ := logger.NewRotatingLogWriter("dionyhub_system.log", 10)
	return &Manager{
		processes: make(map[string]*Process),
		console:   console,
		ws:        ws,
		sysLogger: sysLogger,
	}
}

// WriteSystemLog broadcasts a message to the WebSocket and persists it in the system audit log.
func (m *Manager) WriteSystemLog(message string) {
	type WSLog struct {
		ID   string `json:"id"`
		Data string `json:"data"`
	}
	wsMsgSys, _ := json.Marshal(WSLog{ID: "system", Data: message})
	m.ws.Write(wsMsgSys)

	if m.sysLogger != nil {
		m.sysLogger.Write([]byte(message))
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
	m.WriteSystemLog(sysAuditMsg)
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
	var logWriter *logger.RotatingLogWriter

	if !interactive {
		logDir := filepath.Join(path, "dionyhub_log")
		os.MkdirAll(logDir, 0755)
		logPath := filepath.Join(logDir, "output.log")

		logWriter, _ = logger.NewRotatingLogWriter(logPath, 10)
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
		StartTime:    time.Now(),
	}
	m.mu.Unlock()

	m.sysLog(id, name, fmt.Sprintf("🚀 \x1b[32mProject started successfully (PID: %d).\x1b[0m", pid))

	go func() {
		cmd.Wait()

		m.mu.Lock()
		var intended bool
		var start time.Time
		if p, exists := m.processes[id]; exists {
			p.Running = false
			intended = p.IntendedStop
			start = p.StartTime

			if p.LogWriter != nil {
				p.LogWriter.Close()
			}
		}
		m.mu.Unlock()

		os.Remove(pidFile)

		uptime := time.Since(start)
		isCrash := !intended
		if m.OnExit != nil {
			m.OnExit(id, name, uptime, isCrash)
		}

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
