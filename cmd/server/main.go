package main

import (
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
	log.Println("Starting DionyHub Server...")

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

				// YENİ: p.AutoRestart parametresi Start'a eklendi
				err := procManager.Start(p.ID, p.Name, p.Path, p.Interactive, p.AutoRestart, globalEnvs, parts[0], parts[1:]...)
				if err != nil {
					log.Printf("Failed to auto-start project %s: %v", p.Name, err)
				} else {
					log.Printf("Auto-started project: %s", p.Name)
				}
			}
		}
	}

	server := api.NewServer(procManager, projects, broadcaster)
	mux := http.NewServeMux()

	fs := http.FileServer(http.Dir("./web"))
	mux.Handle("/", fs)
	server.RegisterRoutes(mux)

	log.Println("Server is running on http://localhost:8080")
	if err := http.ListenAndServe(":8080", mux); err != nil {
		log.Fatalf("Server crashed: %v", err)
	}
}
