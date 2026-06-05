// Package process recovery.go
// Responsible for detecting and re-attaching to orphaned process trees using PID files.
package process

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v3/process"
)

// Recover attempts to re-attach to an orphaned process using its stored PID file.
func (m *Manager) Recover(id, name, path string) bool {
	slog.Debug("Checking for orphaned process recovery", slog.String("project_id", id))

	pidFile := filepath.Join(path, ".diony_hub.pid")
	data, err := os.ReadFile(pidFile)
	if err != nil {
		// Normal durum, proje çalışmıyor demektir. Log dosyasını şişirmemek için sessizce dönüyoruz.
		return false
	}

	pidStr := strings.TrimSpace(string(data))
	pid, err := strconv.Atoi(pidStr)
	if err != nil {
		slog.Warn("Corrupted PID file detected during recovery", slog.String("project_id", id), slog.String("path", pidFile), slog.Any("error", err))
		return false
	}

	exists, err := process.PidExists(int32(pid))
	if err != nil || !exists {
		slog.Debug("PID file found but process is dead. Cleaning up.", slog.String("project_id", id), slog.Int("pid", pid))
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
		StartTime:    time.Now(),
	}
	m.mu.Unlock()

	slog.Info("Successfully recovered and re-attached to orphaned process", slog.String("project_id", id), slog.Int("pid", pid))
	m.sysLog(id, name, fmt.Sprintf("🔄 \x1b[36mRecovered orphaned process (PID: %d)\x1b[0m", pid))

	go func() {
		slog.Debug("Started monitoring routine for recovered process", slog.String("project_id", id))
		for {
			time.Sleep(2 * time.Second)
			alive, _ := process.PidExists(int32(pid))
			if !alive {
				m.mu.Lock()
				var intended bool
				var start time.Time
				if p, ok := m.processes[id]; ok && p.RecoveredPID == pid {
					p.Running = false
					intended = p.IntendedStop
					start = p.StartTime
				}
				m.mu.Unlock()

				os.Remove(pidFile)

				uptime := time.Since(start)
				isCrash := !intended

				slog.Warn("Recovered process has exited", slog.String("project_id", id), slog.Bool("intended", intended), slog.String("uptime", uptime.String()))

				if m.OnExit != nil {
					m.OnExit(id, name, uptime, isCrash)
				}

				m.sysLog(id, name, "⚪ Recovered process exited.")
				break
			}
		}
	}()

	return true
}
