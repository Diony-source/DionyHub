package main

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/Diony-source/DionyHub/internal/api"
	"github.com/Diony-source/DionyHub/internal/config"
	"github.com/Diony-source/DionyHub/internal/process"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to initialize environment: %v", err)
	}

	projects, err := config.LoadProjects("config.json")
	if err != nil {
		log.Fatalf("Failed to load projects: %v", err)
	}

	broadcaster := api.NewBroadcaster()
	multiOutput := io.MultiWriter(os.Stdout, broadcaster)

	manager := process.NewManager(multiOutput)
	apiServer := api.NewServer(manager, projects, broadcaster)

	mux := http.NewServeMux()
	apiServer.RegisterRoutes(mux)
	mux.Handle("/", http.FileServer(http.Dir("web")))

	addr := fmt.Sprintf(":%s", cfg.Port)
	log.Println("----------------------------------------")
	log.Printf("Starting DionyHub Backend...")
	log.Printf("Loaded %d projects from config", len(projects))

	// YENİ: Auto-Start Döngüsü (Sunucu açılır açılmaz çalışacaklar)
	autoStartCount := 0
	for _, p := range projects {
		if p.AutoStart {
			autoStartCount++
			parts := strings.Fields(p.Command)
			if len(parts) > 0 {
				log.Printf("[Auto-Start] Launching %s...", p.Name)
				err := manager.Start(p.ID, p.Name, p.Path, p.Interactive, parts[0], parts[1:]...)
				if err != nil {
					log.Printf("[Auto-Start Error] Failed to launch %s: %v", p.Name, err)
				}
			}
		}
	}
	if autoStartCount > 0 {
		log.Printf("Successfully auto-started %d projects.", autoStartCount)
	}

	log.Printf("Listening on http://localhost%s", addr)
	log.Println("----------------------------------------")

	err = http.ListenAndServe(addr, mux)
	if err != nil {
		log.Fatalf("Server forcefully shut down: %v", err)
	}
}
