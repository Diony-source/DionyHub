// Package process manager.go
// Handles the core lifecycle operations (Start, Stop, Write Input) of underlying OS processes.
package process

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
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
	slog.Debug("Initializing core process manager")
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
			// DİKKAT: Normal kapanışları yoksay, sadece olağanüstü okuma hatalarını logla
			if err != io.EOF && !errors.Is(err, os.ErrClosed) && !strings.Contains(err.Error(), "file already closed") {
				slog.Error("Stream read error occurred", slog.String("project_id", id), slog.Any("error", err))
				m.sysLog(id, name, fmt.Sprintf("\x1b[31m[SYSTEM LOG ERROR] %v\x1b[0m", err))
			}
			break
		}
	}
}

func (m *Manager) WriteInput(id string, input string) error {
	slog.Debug("Sending standard input (stdin) to process", slog.String("project_id", id))
	m.mu.RLock()
	p, exists := m.processes[id]
	m.mu.RUnlock()

	if !exists || !p.Running {
		slog.Warn("Attempted to write input to non-running process", slog.String("project_id", id))
		return errors.New("process is not running")
	}

	if p.Stdin == nil {
		slog.Warn("Attempted to write input, but stdin pipe is missing", slog.String("project_id", id))
		return errors.New("this process does not accept internal terminal inputs")
	}

	if p.LogWriter != nil {
		p.LogWriter.Write([]byte(input))
	}

	_, err := io.WriteString(p.Stdin, input)
	if err != nil {
		slog.Error("Failed to write to stdin pipe", slog.String("project_id", id), slog.Any("error", err))
	}
	return err
}

func (m *Manager) Start(id, name, path string, interactive bool, autoRestart bool, globalEnvs []string, nameCmd string, args ...string) error {
	slog.Info("Requesting process start", slog.String("project_id", id), slog.String("command", nameCmd), slog.Bool("interactive", interactive))

	m.mu.Lock()
	if p, exists := m.processes[id]; exists && p.Running {
		m.mu.Unlock()
		slog.Warn("Process is already running, ignoring start request", slog.String("project_id", id))
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
		} else {
			slog.Error("Failed to attach stdout pipe", slog.String("project_id", id), slog.Any("error", err))
		}

		stderr, err := cmd.StderrPipe()
		if err == nil {
			go m.prefixLogger(id, name, stderr, logWriter)
		} else {
			slog.Error("Failed to attach stderr pipe", slog.String("project_id", id), slog.Any("error", err))
		}

		stdinPipe, _ = cmd.StdinPipe()
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	}

	cmd.Env = os.Environ()
	cmd.Env = append(cmd.Env, globalEnvs...)

	if err := cmd.Start(); err != nil {
		slog.Error("OS rejected process start", slog.String("project_id", id), slog.Any("error", err))
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

	slog.Info("OS Process successfully spawned", slog.String("project_id", id), slog.Int("pid", pid))
	m.sysLog(id, name, fmt.Sprintf("🚀 \x1b[32mProject started successfully (PID: %d).\x1b[0m", pid))

	go func() {
		// Wait returns error if process exits with non-zero status
		waitErr := cmd.Wait()

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

		if waitErr != nil && !intended {
			slog.Warn("Process terminated with non-zero exit code (Crash)",
				slog.String("project_id", id),
				slog.String("uptime", uptime.String()),
				slog.Any("exit_error", waitErr),
			)
		} else if !intended {
			slog.Warn("Process terminated unexpectedly but cleanly", slog.String("project_id", id))
		} else {
			slog.Debug("Process terminated normally due to user stop signal", slog.String("project_id", id))
		}

		if m.OnExit != nil {
			m.OnExit(id, name, uptime, isCrash)
		}

		if autoRestart && !intended {
			slog.Warn("Auto-restart condition met, scheduling recovery", slog.String("project_id", id))
			m.sysLog(id, name, "⚠️ \x1b[33mProcess crashed! Restarting in 3 seconds...\x1b[0m")
			time.Sleep(3 * time.Second)

			m.mu.RLock()
			stillExists := false
			if p, exists := m.processes[id]; exists && !p.Running {
				stillExists = true
			}
			m.mu.RUnlock()

			if stillExists {
				slog.Info("Executing auto-recovery restart sequence", slog.String("project_id", id))
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
	slog.Info("Stop sequence initiated for process", slog.String("project_id", id))

	m.mu.Lock()
	p, exists := m.processes[id]
	if exists {
		p.IntendedStop = true
	}
	m.mu.Unlock()

	if !exists || !p.Running {
		slog.Warn("Attempted to stop a non-running process", slog.String("project_id", id))
		return errors.New("process is not currently running")
	}

	var pid int
	if p.Cmd != nil && p.Cmd.Process != nil {
		pid = p.Cmd.Process.Pid
	} else if p.RecoveredPID > 0 {
		pid = p.RecoveredPID
	} else {
		slog.Error("Failed to resolve PID for termination", slog.String("project_id", id))
		return errors.New("cannot determine process ID to kill")
	}

	m.sysLog(id, p.Name, "🛑 Stop signal sent. Terminating process tree...")
	slog.Debug("Summoning Zombie Reaper", slog.String("project_id", id), slog.Int("pid", pid))

	// YENİ: Zombi Avcısını tetikliyoruz. Tüm ağaç kökünden kazınıyor!
	err := killProcessTree(pid)

	// Windows'taki harici "CMD" pencerelerini kapatmak için isim bazlı ekstra güvenlik (Opsiyonel)
	if runtime.GOOS == "windows" {
		windowTitle := fmt.Sprintf("%s - DionyHub*", p.Name)
		titleKillCmd := exec.Command("taskkill", "/F", "/FI", fmt.Sprintf("WINDOWTITLE eq %s", windowTitle))
		titleKillCmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		titleKillCmd.Run()
	}

	if err != nil {
		slog.Error("Reaper failed to terminate process tree completely", slog.String("project_id", id), slog.Int("pid", pid), slog.Any("error", err))
	} else {
		slog.Info("Zombie Reaper successfully cleared process tree", slog.String("project_id", id), slog.Int("pid", pid))
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

	slog.Info("Global shutdown hook triggered: Terminating all active process trees", slog.Int("active_count", len(ids)))

	for _, id := range ids {
		m.Stop(id)
	}
}
