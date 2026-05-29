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
	Status      string `json:"status"`
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

// SaveProjects safely writes the current project list back to the JSON configuration file.
func SaveProjects(filePath string, projects []Project) error {
	cfg := projectConfig{Projects: projects}

	// JSON'u okunabilir (girintili) formatta marshal et
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal projects to JSON: %w", err)
	}

	// Dosyayı standart izinlerle yaz (0644)
	err = os.WriteFile(filePath, data, 0644)
	if err != nil {
		return fmt.Errorf("failed to write projects file '%s': %w", filePath, err)
	}

	return nil
}
