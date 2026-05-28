// Package config handles all environment variables and configuration data for the application.
package config

import (
	"errors"
	"fmt"
	"os"

	"github.com/joho/godotenv"
)

// AppConfig holds the complete configuration required for the application to run safely.
type AppConfig struct {
	Port        string
	Environment string
}

// Load reads the .env file and populates the AppConfig struct.
// It returns an explicit error if critical configurations are missing or cannot be parsed.
func Load() (*AppConfig, error) {
	// Attempt to load the .env file. We don't strictly fail if it's missing,
	// as environment variables might be set at the OS level (e.g., in a Docker container).
	err := godotenv.Load()
	if err != nil {
		// Log the information but don't halt, to support environment-level variables.
		fmt.Println("INFO: No .env file found or unable to read it. Relying on system environment variables.")
	}

	port := os.Getenv("PORT")
	if port == "" {
		return nil, errors.New("critical configuration missing: PORT is not set")
	}

	env := os.Getenv("ENVIRONMENT")
	if env == "" {
		env = "production" // Default to safe mode
	}

	return &AppConfig{
		Port:        port,
		Environment: env,
	}, nil
}
