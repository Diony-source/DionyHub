package config

import (
	"encoding/json"
	"os"
	"sync"
)

var projectsMu sync.Mutex

// Project represents a single application managed by DionyHub
type Project struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Path        string  `json:"path"`
	Command     string  `json:"command"`
	Tag         string  `json:"tag"`
	Interactive bool    `json:"interactive"`
	AutoStart   bool    `json:"auto_start"`
	AutoRestart bool    `json:"auto_restart"` // YENİ: Watchdog (Otomatik Yeniden Başlatma)
	Status      string  `json:"status,omitempty"`
	Order       int     `json:"order"`
	CPU         float64 `json:"cpu,omitempty"`
	RAM         float64 `json:"ram,omitempty"`
}

// LoadProjects reads the project configurations securely from the JSON file
func LoadProjects(filename string) ([]Project, error) {
	projectsMu.Lock()
	defer projectsMu.Unlock()

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

// SaveProjects securely writes the project configurations to the JSON file
func SaveProjects(filename string, projects []Project) error {
	projectsMu.Lock()
	defer projectsMu.Unlock()

	data, err := json.MarshalIndent(projects, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(filename, data, 0644)
}
