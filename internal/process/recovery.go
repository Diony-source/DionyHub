// Package process recovery.go
// Responsible for detecting and re-attaching to orphaned process trees using PID files.
package process

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v3/process"
)

// Recover attempts to re-attach to an orphaned process using its stored PID file.
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
		StartTime:    time.Now(),
	}
	m.mu.Unlock()

	m.sysLog(id, name, fmt.Sprintf("🔄 \x1b[36mRecovered orphaned process (PID: %d)\x1b[0m", pid))

	go func() {
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
