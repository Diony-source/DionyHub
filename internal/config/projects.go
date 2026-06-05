// Package config provides data structures and functions to manage
// the configuration of projects and application settings within DionyHub.
package config

import (
	"encoding/json"
	"log/slog" // YENİ: Kademeli loglama motorumuzu dahil ediyoruz
	"os"
	"sync"
)

// Project represents a single manageable unit (repository or local directory)
// within the ecosystem. It securely holds execution variables and state preferences.
type Project struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Path         string `json:"path"`
	Command      string `json:"command"`
	Tag          string `json:"tag"`
	Interactive  bool   `json:"interactive"`
	AutoStart    bool   `json:"auto_start"`
	AutoRestart  bool   `json:"auto_restart"`
	AutoClose    bool   `json:"auto_close"`
	ClearOnStart bool   `json:"clear_on_start"` // Indicates if the terminal should be wiped before execution
	Source       string `json:"source"`
	Status       string `json:"status"`
	Order        int    `json:"order"`
}

var (
	// mu ensures thread-safe access when reading or writing configurations to disk,
	// preventing race conditions during concurrent API requests.
	mu sync.RWMutex
)

// LoadProjects reads the configuration file from disk and unmarshals it into a slice of Project.
func LoadProjects(filename string) ([]Project, error) {
	slog.Debug("Attempting to load projects configuration", slog.String("filename", filename))

	mu.RLock()
	defer mu.RUnlock()

	data, err := os.ReadFile(filename)
	if err != nil {
		if os.IsNotExist(err) {
			slog.Debug("Projects configuration file does not exist, returning empty slice", slog.String("filename", filename))
			return []Project{}, nil
		}
		slog.Error("Failed to read projects configuration file", slog.String("filename", filename), slog.Any("error", err))
		return nil, err
	}

	var projects []Project
	if err := json.Unmarshal(data, &projects); err != nil {
		slog.Error("Failed to unmarshal projects JSON data", slog.String("filename", filename), slog.Any("error", err))
		return nil, err
	}

	slog.Debug("Successfully loaded projects", slog.Int("count", len(projects)))
	return projects, nil
}

// SaveProjects safely marshals a slice of Project into JSON format and writes it to the specified file.
func SaveProjects(filename string, projects []Project) error {
	slog.Debug("Attempting to save projects configuration", slog.String("filename", filename), slog.Int("count", len(projects)))

	mu.Lock()
	defer mu.Unlock()

	data, err := json.MarshalIndent(projects, "", "  ")
	if err != nil {
		slog.Error("Failed to marshal projects to JSON", slog.Any("error", err))
		return err
	}

	// 0644 permission ensures the file is readable by others but only writable by the owner
	err = os.WriteFile(filename, data, 0644)
	if err != nil {
		slog.Error("Failed to write projects to disk", slog.String("filename", filename), slog.Any("error", err))
		return err
	}

	slog.Debug("Successfully saved projects configuration", slog.String("filename", filename))
	return nil
}
