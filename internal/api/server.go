// Package api provides HTTP handlers, WebSocket broadcasting, and core server configurations for DionyHub.
package api

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/Diony-source/DionyHub/internal/config"
	"github.com/Diony-source/DionyHub/internal/database" // YENİ: Veritabanı paketimizi içeri alıyoruz
	"github.com/Diony-source/DionyHub/internal/process"
)

// Server holds the core dependencies for serving API requests.
type Server struct {
	manager     *process.Manager
	mu          sync.RWMutex
	projects    []config.Project
	broadcaster *Broadcaster
	db          *database.Engine // YENİ: Titanyum SQLite motorumuz artık API sunucusunun merkezinde
}

// NewServer initializes a new Server, injects dependencies, and configures crash detection callbacks.
func NewServer(m *process.Manager, p []config.Project, b *Broadcaster, db *database.Engine) *Server {
	slog.Debug("Initializing core API server instance with SQLite integration")

	s := &Server{
		manager:     m,
		projects:    p,
		broadcaster: b,
		db:          db, // YENİ: main.go'dan gelen motoru sunucumuza takıyoruz
	}

	// Setup global crash and exit detection hook
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
			// PROJE ÇÖKTÜĞÜNDE KIRMIZI ALARM (Hem arayüze hem arşive)
			slog.Error("Project process crashed unexpectedly!",
				slog.String("project_id", id),
				slog.String("project_name", name),
				slog.String("uptime", uptimeStr),
			)
			projMsg = fmt.Sprintf("\r\n\x1b[1;31m[DionyHub] Process crashed unexpectedly! (Uptime: %s)\x1b[0m\r\n", uptimeStr)
			sysMsg = fmt.Sprintf("\x1b[1;31m[CRASH]\x1b[0m Project '%s' crashed after %s.", name, uptimeStr)
		} else {
			// KULLANICI KENDİ KAPATTIĞINDA (Sadece bilgi logu)
			slog.Info("Project process stopped by user",
				slog.String("project_id", id),
				slog.String("project_name", name),
				slog.String("uptime", uptimeStr),
			)
			projMsg = fmt.Sprintf("\r\n\x1b[1;33m[DionyHub] Process stopped by user. (Uptime: %s)\x1b[0m\r\n", uptimeStr)
			sysMsg = fmt.Sprintf("\x1b[1;33m[INFO]\x1b[0m Project '%s' stopped by user after %s.", name, uptimeStr)
		}

		// Yutulan hatayı ( _ ) düzelttik
		projLog, err := json.Marshal(map[string]string{"id": id, "data": projMsg})
		if err != nil {
			slog.Error("Failed to marshal exit message for websocket", slog.Any("error", err))
		} else {
			s.broadcaster.Write(projLog)
		}

		// Diske de kaydet (DionyHub sistem terminalinde görünmesi için)
		s.manager.WriteSystemLog(sysMsg + "\r\n")
	}

	return s
}
