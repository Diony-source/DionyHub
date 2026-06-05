// Package process stats.go
// Handles real-time system resource monitoring (CPU, RAM, Uptime) for running projects.
package process

import (
	"log/slog"
	"time"

	"github.com/shirou/gopsutil/v3/process"
)

// GetStats retrieves real-time CPU, RAM usage, and uptime for a running process.
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
		// DİKKAT: Bu fonksiyon sık çağrılır. İşlem o an kapanıyorsa hata verebilir.
		// Sadece debug modunda görmek için logluyoruz, ana log dosyasını şişirmiyoruz.
		slog.Debug("Failed to attach to process for metrics collection", slog.String("project_id", id), slog.Int("pid", pid), slog.Any("error", err))
		return 0, 0, int64(time.Since(p.StartTime).Seconds())
	}

	cpuPercent, err := proc.CPUPercent()
	if err != nil {
		slog.Debug("Failed to read CPU metrics", slog.String("project_id", id), slog.Any("error", err))
	}

	memInfo, err := proc.MemoryInfo()
	if err != nil {
		slog.Debug("Failed to read Memory metrics", slog.String("project_id", id), slog.Any("error", err))
	}

	if memInfo != nil {
		ram = float64(memInfo.RSS) / (1024 * 1024)
	}

	return cpuPercent, ram, int64(time.Since(p.StartTime).Seconds())
}
