package config

import (
	"encoding/json"
	"fmt"
	"os"
)

// Project represents the configuration for a single manageable application.
type Project struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Path        string `json:"path"`
	Command     string `json:"command"`
	Interactive bool   `json:"interactive"`
	Status      string `json:"status"` // YENİ EKLENDİ: Arayüze canlı durum yollamak için gerekli
}

// projectConfig is a wrapper to match the JSON structure.
type projectConfig struct {
	Projects []Project `json:"projects"`
}

// LoadProjects safely reads and parses the given JSON file.
func LoadProjects(filePath string) ([]Project, error) {
	file, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read projects file '%s': %w", filePath, err)
	}

	var cfg projectConfig
	if err := json.Unmarshal(file, &cfg); err != nil {
		return nil, fmt.Errorf("failed to parse projects JSON: %w", err)
	}

	return cfg.Projects, nil
}
