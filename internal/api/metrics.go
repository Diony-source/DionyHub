// Package api - metrics.go
// Responsible for continuously monitoring and broadcasting project hardware metrics (CPU, RAM, Uptime).
package api

import (
	"encoding/json"
	"math"
	"time"
)

// startMetricsPusher periodically gathers CPU/RAM stats and pushes them to the frontend via WebSocket.
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
