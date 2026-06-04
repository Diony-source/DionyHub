package config

import (
	"encoding/json"
	"os"
	"sync"
)

var settingsMu sync.Mutex

// AppSettings holds the global configuration for DionyHub
type AppSettings struct {
	Workspace string   `json:"workspace"`
	LogBuffer bool     `json:"log_buffer"`
	GlobalEnv string   `json:"global_env"`
	SavedTags []string `json:"saved_tags"` // YENİ: Projesiz bile ayakta kalabilen kalıcı Tag listesi
}

// LoadSettings retrieves settings securely from disk
func LoadSettings(filename string) (AppSettings, error) {
	settingsMu.Lock()
	defer settingsMu.Unlock()

	var settings AppSettings
	data, err := os.ReadFile(filename)
	if err != nil {
		if os.IsNotExist(err) {
			return settings, nil
		}
		return settings, err
	}

	err = json.Unmarshal(data, &settings)
	return settings, err
}

// SaveSettings securely writes global settings using Atomic Write
func SaveSettings(filename string, settings AppSettings) error {
	settingsMu.Lock()
	defer settingsMu.Unlock()

	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}

	// ATOMIC WRITE: Sistem çökse bile ayarların bozulmasını engeller
	tmpFile := filename + ".tmp"
	if err := os.WriteFile(tmpFile, data, 0644); err != nil {
		return err
	}

	return os.Rename(tmpFile, filename)
}
