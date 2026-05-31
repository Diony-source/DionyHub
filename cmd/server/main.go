package main

import (
	"io" // YENİ: MultiWriter için eklendi
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/Diony-source/DionyHub/internal/api"
	"github.com/Diony-source/DionyHub/internal/config"
	"github.com/Diony-source/DionyHub/internal/process"
)

func main() {
	log.Println("Starting DionyHub Server...")

	// Projeleri yükle
	projects, _ := config.LoadProjects("config.json")

	// 1. Broadcaster'ı (WebSocket Yayıncısı) ayağa kaldır
	broadcaster := api.NewBroadcaster()
	go broadcaster.Run()

	// 2. SİHİRLİ DOKUNUŞ: Logları hem CMD terminaline hem de Web Arayüzüne (Live Terminal) kopyala!
	multiWriter := io.MultiWriter(os.Stdout, broadcaster)

	// 3. Process Manager'a bu çoklu yazıcıyı bağla ki loglar arayüze aksın
	procManager := process.NewManager(multiWriter)

	// Auto-Start (Otomatik Başlatma) Döngüsü
	for _, p := range projects {
		if p.AutoStart {
			parts := strings.Fields(p.Command)
			if len(parts) > 0 {

				// Global ayarları ve ENV'leri yükle
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

				// Projeyi çalıştır
				err := procManager.Start(p.ID, p.Name, p.Path, p.Interactive, globalEnvs, parts[0], parts[1:]...)
				if err != nil {
					log.Printf("Failed to auto-start project %s: %v", p.Name, err)
				} else {
					log.Printf("Auto-started project: %s", p.Name)
				}
			}
		}
	}

	// API Sunucusunu kur
	server := api.NewServer(procManager, projects, broadcaster)
	mux := http.NewServeMux()

	// Statik (HTML/JS/CSS) dosyaları sun
	fs := http.FileServer(http.Dir("./web"))
	mux.Handle("/", fs)

	// Route'ları (Uç noktaları) kaydet
	server.RegisterRoutes(mux)

	log.Println("Server is running on http://localhost:8080")
	if err := http.ListenAndServe(":8080", mux); err != nil {
		log.Fatalf("Server crashed: %v", err)
	}
}
