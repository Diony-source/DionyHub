package main

import (
	"context"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/Diony-source/DionyHub/internal/api"
	"github.com/Diony-source/DionyHub/internal/config"
	"github.com/Diony-source/DionyHub/internal/process"
)

func main() {
	log.Println("[SYSTEM] Starting DionyHub Command Center...")

	projects, _ := config.LoadProjects("config.json")
	broadcaster := api.NewBroadcaster()
	multiWriter := io.MultiWriter(os.Stdout, broadcaster)
	procManager := process.NewManager(multiWriter)

	for _, p := range projects {
		if p.AutoStart {
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
				} else {
					log.Printf("[SYSTEM] Auto-started project: %s", p.Name)
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

	// YENİ: Graceful Shutdown (Güvenli Kapanış) Kanalı
	stop := make(chan os.Signal, 1)
	// İşletim sisteminden gelen Interrupt (Ctrl+C) veya Terminate sinyallerini yakala
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	// Web sunucusunu kendi goroutine'inde (arka planda) başlatıyoruz
	go func() {
		log.Println("[SYSTEM] Server is running on http://localhost:8080")
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[SYSTEM] Server crashed: %v", err)
		}
	}()

	// Sistem sinyal gelene kadar burada bekler (Bloklar)
	<-stop

	log.Println("\n[SYSTEM] Shutdown signal received! Initiating Graceful Shutdown...")

	// 1. ADIM: Açık olan tüm projeleri güvenli şekilde öldür (Zombi avı)
	log.Println("[SYSTEM] Terminating all running background processes...")
	procManager.StopAll()

	// 2. ADIM: Web sunucusunu güvenli şekilde kapat (Bağlı kullanıcılar varsa 5 saniye bekle)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := httpServer.Shutdown(ctx); err != nil {
		log.Printf("[SYSTEM] Server forced to shutdown: %v", err)
	}

	log.Println("[SYSTEM] DionyHub shutdown sequence complete. Goodbye!")
}
