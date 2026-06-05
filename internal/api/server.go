// Package api provides HTTP handlers and WebSocket broadcasting for DionyHub.
package api

import (
	"encoding/json"
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/Diony-source/DionyHub/internal/config"
	"github.com/Diony-source/DionyHub/internal/process"
)

// Server holds the core dependencies for serving API requests.
type Server struct {
	manager     *process.Manager
	mu          sync.RWMutex
	projects    []config.Project
	broadcaster *Broadcaster
}

// NewServer initializes a new Server and configures crash detection callbacks.
func NewServer(m *process.Manager, p []config.Project, b *Broadcaster) *Server {
	s := &Server{
		manager:     m,
		projects:    p,
		broadcaster: b,
	}

	s.manager.OnExit = func(id string, name string, uptime time.Duration, isCrash bool) {
		uptimeStr := ""
		hrs := int(uptime.Hours())
		mins := int(uptime.Minutes()) % 60
		secs := int(uptime.Seconds()) % 60

		if hrs > 0 {
			uptimeStr = fmt.Sprintf("%dh %dm", hrs, mins)
		} else if mins > 0 {
			uptimeStr = fmt.Sprintf("%dm %ds", mins, secs)
		} else {
			uptimeStr = fmt.Sprintf("%ds", secs)
		}

		var projMsg, sysMsg string
		if isCrash {
			projMsg = fmt.Sprintf("\r\n\x1b[1;31m[DionyHub] Process crashed unexpectedly! (Uptime: %s)\x1b[0m\r\n", uptimeStr)
			sysMsg = fmt.Sprintf("\x1b[1;31m[CRASH]\x1b[0m Project '%s' crashed after %s.", name, uptimeStr)
		} else {
			projMsg = fmt.Sprintf("\r\n\x1b[1;33m[DionyHub] Process stopped by user. (Uptime: %s)\x1b[0m\r\n", uptimeStr)
			sysMsg = fmt.Sprintf("\x1b[1;33m[INFO]\x1b[0m Project '%s' stopped by user after %s.", name, uptimeStr)
		}

		projLog, _ := json.Marshal(map[string]string{"id": id, "data": projMsg})
		s.broadcaster.Write(projLog)

		s.manager.WriteSystemLog(sysMsg + "\r\n")
	}

	return s
}

// startMetricsPusher periodically gathers CPU/RAM stats and pushes them to the frontend.
func (s *Server) startMetricsPusher() {
	for {
		time.Sleep(2 * time.Second)
		s.mu.RLock()

		stats := make([]map[string]interface{}, 0)
		for _, p := range s.projects {
			if s.manager.IsRunning(p.ID) {
				cpu, ram, uptime := s.manager.GetStats(p.ID)

				if math.IsNaN(cpu) || math.IsInf(cpu, 0) {
					cpu = 0
				}
				if math.IsNaN(ram) || math.IsInf(ram, 0) {
					ram = 0
				}

				stats = append(stats, map[string]interface{}{
					"id": p.ID, "status": "running", "cpu": cpu, "ram": ram, "uptime": uptime,
				})
			} else {
				stats = append(stats, map[string]interface{}{
					"id": p.ID, "status": "stopped",
				})
			}
		}
		s.mu.RUnlock()

		payload, _ := json.Marshal(stats)

		type WSLog struct {
			ID   string `json:"id"`
			Data string `json:"data"`
		}

		wsMsg, _ := json.Marshal(WSLog{ID: "metrics", Data: string(payload)})
		s.broadcaster.Write(wsMsg)
	}
}
