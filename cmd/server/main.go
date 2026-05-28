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
	// 1. Load Environment Configuration
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to initialize environment: %v", err)
	}

	// 2. Load Projects Configuration
	projects, err := config.LoadProjects("config.json")
	if err != nil {
		log.Fatalf("Failed to load projects: %v", err)
	}

	// 3. Initialize Process Manager
	manager := process.NewManager()

	// 4. Initialize API Server & Routes
	apiServer := api.NewServer(manager, projects)
	mux := http.NewServeMux()
	apiServer.RegisterRoutes(mux)

	// 5. Start HTTP Server
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
