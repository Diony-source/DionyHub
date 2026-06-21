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
	"github.com/Diony-source/DionyHub/internal/database"
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

// SystemLogWrapper yakaladığı logları ASENKRON olarak WebSocket'e fırlatır
type SystemLogWrapper struct {
	ws io.Writer
}

func (s *SystemLogWrapper) Write(p []byte) (n int, err error) {
	// Log verisini kopyalıyoruz çünkü Goroutine içinde bağımsız işleyeceğiz
	msgCopy := make([]byte, len(p))
	copy(msgCopy, p)

	// Slog'u asla bloklamamak ve DEADLOCK'u önlemek için arka plana (Goroutine) atıyoruz
	go func() {
		// Olası bir çökmede sistemi korumak için kurtarıcı
		defer func() { recover() }()

		text := string(msgCopy)
		text = strings.ReplaceAll(text, "\n", "\r\n")

		// Matrix Hissi: Log seviyesine göre ANSI terminal renkleri ekle
		if strings.Contains(text, "level=ERROR") {
			text = "\x1b[1;31m" + text + "\x1b[0m" // Kırmızı
		} else if strings.Contains(text, "level=WARN") {
			text = "\x1b[1;33m" + text + "\x1b[0m" // Sarı
		} else if strings.Contains(text, "level=DEBUG") {
			text = "\x1b[1;36m" + text + "\x1b[0m" // Mavi
		} else {
			text = "\x1b[1;32m" + text + "\x1b[0m" // Yeşil (INFO)
		}

		type WSLog struct {
			ID   string `json:"id"`
			Data string `json:"data"`
		}
		wsMsg, _ := json.Marshal(WSLog{ID: "system", Data: text})
		s.ws.Write(wsMsg)
	}()

	// slog motoruna "işlem tamamlandı" diyip anında geri dönüyoruz (0 Gecikme)
	return len(p), nil
}

func main() {
	// 1. Arayüz Broadcaster'ı ve Wrapper'ı Hazırla
	broadcaster := api.NewBroadcaster()
	sysWrapper := &SystemLogWrapper{ws: broadcaster}

	// 2. Fiziksel Log Dosyasını Aç
	logFile, err := os.OpenFile("dionyhub_system.log", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0666)
	if err != nil {
		panic("CRITICAL: Log file creation failed: " + err.Error())
	}
	defer logFile.Close()

	// 3. TEE WRITER: Slog'un çıktısını Konsol + Dosya + Asenkron UI Terminaline böler
	multiWriter := io.MultiWriter(os.Stdout, logFile, sysWrapper)
	slog.SetDefault(slog.New(slog.NewTextHandler(multiWriter, &slog.HandlerOptions{
		Level: slog.LevelDebug,
	})))

	slog.Info("Starting DionyHub Command Center Initialization...")

	// 4. Veritabanı Motoru Başlatılır
	dbPath := "data/dionyhub.db"
	dbEngine, err := database.NewEngine(dbPath)
	if err != nil {
		slog.Error("CRITICAL: Failed to initialize database engine", slog.Any("error", err))
		panic("Database initialization failed! See logs for details.")
	}
	defer dbEngine.Close()

	// 5. Göç Kontrolü
	if err := dbEngine.MigrateFromJSON("config.json"); err != nil {
		slog.Warn("Failed to migrate legacy JSON data", slog.Any("error", err))
	}

	clearHubPort()

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

	server := api.NewServer(procManager, projects, broadcaster, dbEngine)
	mux := http.NewServeMux()

	fs := http.FileServer(http.Dir("./web"))
	mux.Handle("/", fs)
	server.RegisterRoutes(mux)

	loggedMux := api.LoggingMiddleware(mux)

	httpServer := &http.Server{
		Addr:    ":8080",
		Handler: loggedMux,
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	go func() {
		slog.Info("Server is successfully running and listening", slog.String("url", "http://localhost:8080"))
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
