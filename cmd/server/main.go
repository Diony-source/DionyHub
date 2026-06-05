package main

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/Diony-source/DionyHub/internal/api"
	"github.com/Diony-source/DionyHub/internal/config"
	"github.com/Diony-source/DionyHub/internal/logger"
	"github.com/Diony-source/DionyHub/internal/process"
)

func clearHubPort() {
	if runtime.GOOS == "windows" {
		psCmd := `
		$tcp = Get-NetTCPConnection -LocalPort 8080 -ErrorAction SilentlyContinue
		if ($tcp) {
			$process = Get-Process -Id $tcp.OwningProcess -ErrorAction SilentlyContinue
			if ($process) {
				Stop-Process -Id $process.Id -Force
			}
		}`
		cmd := exec.Command("powershell", "-NoProfile", "-Command", psCmd)
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		cmd.Run()
		slog.Debug("Cleared potential port 8080 conflicts via PowerShell")
	}
}

type SystemLogWrapper struct {
	ws io.Writer
}

func (s *SystemLogWrapper) Write(p []byte) (n int, err error) {
	type WSLog struct {
		ID   string `json:"id"`
		Data string `json:"data"`
	}
	wsMsg, _ := json.Marshal(WSLog{ID: "system", Data: string(p)})
	s.ws.Write(wsMsg)
	return len(p), nil
}

func main() {
	// 1. Kademeli Loglama Motorunu Başlat
	logger.InitGlobalLogger()
	slog.Info("Starting DionyHub Command Center Initialization...")

	clearHubPort()

	broadcaster := api.NewBroadcaster()
	sysWrapper := &SystemLogWrapper{ws: broadcaster}

	projects, err := config.LoadProjects("config.json")
	if err != nil {
		slog.Warn("Could not load projects.json. Starting with empty library.", slog.Any("error", err))
	} else {
		slog.Info("Successfully loaded project configurations", slog.Int("count", len(projects)))
	}

	procManager := process.NewManager(os.Stdout, broadcaster)

	for _, p := range projects {
		slog.Debug("Checking recovery status for project", slog.String("name", p.Name), slog.String("id", p.ID))
		recovered := procManager.Recover(p.ID, p.Name, p.Path)

		if !recovered && p.AutoStart {
			parts := strings.Fields(p.Command)
			if len(parts) > 0 {
				settings, _ := config.LoadSettings("app_config.json")
				var globalEnvs []string
				if settings.GlobalEnv != "" {
					lines := strings.Split(settings.GlobalEnv, "\n")
					for _, line := range lines {
						line = strings.TrimSpace(line)
						if line != "" && !strings.HasPrefix(line, "#") {
							globalEnvs = append(globalEnvs, line)
						}
					}
				}

				slog.Info("Auto-starting project", slog.String("name", p.Name))
				err := procManager.Start(p.ID, p.Name, p.Path, p.Interactive, p.AutoRestart, globalEnvs, parts[0], parts[1:]...)
				if err != nil {
					slog.Error("Failed to auto-start project", slog.String("name", p.Name), slog.Any("error", err))
				}
			}
		}
	}

	server := api.NewServer(procManager, projects, broadcaster)
	mux := http.NewServeMux()

	fs := http.FileServer(http.Dir("./web"))
	mux.Handle("/", fs)
	server.RegisterRoutes(mux)

	// YENİ: Bütün istekleri (router) Loglama Ajanı ile sarıp sarmalıyoruz
	loggedMux := api.LoggingMiddleware(mux)

	httpServer := &http.Server{
		Addr:    ":8080",
		Handler: loggedMux,
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	go func() {
		slog.Info("Server is successfully running and listening", slog.String("url", "http://localhost:8080"))
		sysWrapper.Write([]byte("DionyHub is ready! Listening on port 8080...\n"))

		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("Server crashed", slog.Any("error", err))
		}
	}()

	<-stop

	slog.Warn("Shutdown signal received! Initiating Graceful Shutdown...")
	slog.Info("Terminating all running background processes...")

	procManager.StopAll()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := httpServer.Shutdown(ctx); err != nil {
		slog.Error("Server forced to shutdown", slog.Any("error", err))
	}

	slog.Info("DionyHub shutdown sequence complete. Goodbye!")
	time.Sleep(1 * time.Second)
}
