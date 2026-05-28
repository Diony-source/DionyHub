// Package main is the entry point for the DionyHub server.
// It strictly handles application bootstrapping and wiring dependencies.
package main

import (
	"log"

	"github.com/Diony-source/DionyHub/internal/config"
)

func main() {
	// 1. Load configuration securely
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to initialize application: %v", err)
	}

	// 2. Initial logging to confirm successful boot
	log.Println("----------------------------------------")
	log.Printf("Starting DionyHub Backend...")
	log.Printf("Environment: %s", cfg.Environment)
	log.Printf("Listening on Port: %s", cfg.Port)
	log.Println("----------------------------------------")

	// Future: Initialize Database/Storage
	// Future: Initialize Process Manager
	// Future: Start HTTP/REST Router
}
