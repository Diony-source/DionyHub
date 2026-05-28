// Package main is the entry point for the DionyHub server.
package main

import (
	"fmt"
	"log"
	"net/http"

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

	manager := process.NewManager()

	apiServer := api.NewServer(manager, projects)
	mux := http.NewServeMux()
	apiServer.RegisterRoutes(mux)

	// YENİ: web klasöründeki HTML dosyasını sunmak için statik dosya sunucusu eklendi
	mux.Handle("/", http.FileServer(http.Dir("web")))

	addr := fmt.Sprintf(":%s", cfg.Port)
	log.Println("----------------------------------------")
	log.Printf("Starting DionyHub Backend...")
	log.Printf("Loaded %d projects from config", len(projects))
	log.Printf("Listening on http://localhost%s", addr)
	log.Println("----------------------------------------")

	err = http.ListenAndServe(addr, mux)
	if err != nil {
		log.Fatalf("Server forcefully shut down: %v", err)
	}
}
