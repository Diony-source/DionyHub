package config

import (
	"encoding/json"
	"os"
	"sync"
)

var mu sync.Mutex

// Project represents the configuration for a single manageable application.
type Project struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Path        string  `json:"path"`
	Command     string  `json:"command"`
	Interactive bool    `json:"interactive"`
	AutoStart   bool    `json:"auto_start"` // YENİ: Otomatik başlatma bayrağı
	Status      string  `json:"status"`
	CPU         float64 `json:"cpu,omitempty"`
	RAM         float64 `json:"ram,omitempty"`
	Tag         string  `json:"tag,omitempty"`
	Order       int     `json:"order,omitempty"`
}

// LoadProjects reads the project configurations from the given JSON file.
func LoadProjects(filename string) ([]Project, error) {
	mu.Lock()
	defer mu.Unlock()

	data, err := os.ReadFile(filename)
	if err != nil {
		if os.IsNotExist(err) {
			return []Project{}, nil
		}
		return nil, err
	}

	var projects []Project
	if err := json.Unmarshal(data, &projects); err != nil {
		return nil, err
	}
	return projects, nil
}

// SaveProjects writes the project configurations to the given JSON file safely.
func SaveProjects(filename string, projects []Project) error {
	mu.Lock()
	defer mu.Unlock()

	data, err := json.MarshalIndent(projects, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(filename, data, 0644)
}
