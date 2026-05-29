package main

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"

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

	// 1. WebSocket Yayıncısını oluştur
	broadcaster := api.NewBroadcaster()

	// 2. Çıktıları çokla (Hem terminale hem tarayıcıya)
	multiOutput := io.MultiWriter(os.Stdout, broadcaster)

	// 3. Yöneticilere dağıt
	manager := process.NewManager(multiOutput)
	apiServer := api.NewServer(manager, projects, broadcaster)

	mux := http.NewServeMux()
	apiServer.RegisterRoutes(mux)
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
