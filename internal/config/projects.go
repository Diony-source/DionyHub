// Package config provides data structures and functions to manage
// the configuration of projects and application settings within DionyHub.
package config

import (
	"encoding/json"
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
// If the target file does not exist, it securely handles the error and returns an empty slice
// to allow seamless initialization of a new workspace.
func LoadProjects(filename string) ([]Project, error) {
	mu.RLock()
	defer mu.RUnlock()

	data, err := os.ReadFile(filename)
	if err != nil {
		if os.IsNotExist(err) {
			return []Project{}, nil
		}
		// Return explicit errors up the call stack instead of ignoring them
		return nil, err
	}

	var projects []Project
	if err := json.Unmarshal(data, &projects); err != nil {
		return nil, err
	}

	return projects, nil
}

// SaveProjects safely marshals a slice of Project into JSON format and writes it to the specified file.
// It explicitly utilizes a mutex lock to guarantee data integrity during concurrent disk writes.
func SaveProjects(filename string, projects []Project) error {
	mu.Lock()
	defer mu.Unlock()

	data, err := json.MarshalIndent(projects, "", "  ")
	if err != nil {
		return err
	}

	// 0644 permission ensures the file is readable by others but only writable by the owner
	return os.WriteFile(filename, data, 0644)
}
