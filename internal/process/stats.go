// Package process stats.go
// Handles real-time system resource monitoring (CPU, RAM, Uptime) for running projects.
package process

import (
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
		return 0, 0, int64(time.Since(p.StartTime).Seconds())
	}

	cpuPercent, _ := proc.CPUPercent()
	memInfo, _ := proc.MemoryInfo()

	if memInfo != nil {
		ram = float64(memInfo.RSS) / (1024 * 1024)
	}

	return cpuPercent, ram, int64(time.Since(p.StartTime).Seconds())
}
