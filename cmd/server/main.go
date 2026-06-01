package main

import (
	"context"
	"encoding/json"
	"io"
	"log"
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
	}
}

// YENİ: Sistem loglarını da WebSocket üzerinden JSON paketi olarak fırlatan kılıf
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
	clearHubPort()

	broadcaster := api.NewBroadcaster()
	sysWrapper := &SystemLogWrapper{ws: broadcaster}

	// CMD konsolu raw logları alır, WS ise JSON sarılı logları alır
	multiWriter := io.MultiWriter(os.Stdout, sysWrapper)

	log.SetOutput(multiWriter)
	log.SetFlags(0)

	log.Println("[SYSTEM] Starting DionyHub Command Center...")

	projects, _ := config.LoadProjects("config.json")

	// YENİ: Manager yapısına konsol ve websocket bağlantılarını ayrıştırarak veriyoruz
	procManager := process.NewManager(os.Stdout, broadcaster)

	for _, p := range projects {
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

				err := procManager.Start(p.ID, p.Name, p.Path, p.Interactive, p.AutoRestart, globalEnvs, parts[0], parts[1:]...)
				if err != nil {
					log.Printf("[SYSTEM] Failed to auto-start project %s: %v", p.Name, err)
				}
			}
		}
	}

	server := api.NewServer(procManager, projects, broadcaster)
	mux := http.NewServeMux()

	fs := http.FileServer(http.Dir("./web"))
	mux.Handle("/", fs)
	server.RegisterRoutes(mux)

	httpServer := &http.Server{
		Addr:    ":8080",
		Handler: mux,
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	go func() {
		log.Println("[SYSTEM] Server is running on http://localhost:8080")
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[SYSTEM] Server crashed: %v", err)
		}
	}()

	<-stop

	log.Println("")
	log.Println("[SYSTEM] Shutdown signal received! Initiating Graceful Shutdown...")
	log.Println("[SYSTEM] Terminating all running background processes...")

	procManager.StopAll()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := httpServer.Shutdown(ctx); err != nil {
		log.Printf("[SYSTEM] Server forced to shutdown: %v", err)
	}

	log.Println("[SYSTEM] DionyHub shutdown sequence complete. Goodbye!")
	time.Sleep(1 * time.Second)
}
