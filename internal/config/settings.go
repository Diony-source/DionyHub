package config

import (
	"encoding/json"
	"log/slog"
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
	slog.Debug("Attempting to load application settings", slog.String("filename", filename))

	settingsMu.Lock()
	defer settingsMu.Unlock()

	var settings AppSettings
	data, err := os.ReadFile(filename)
	if err != nil {
		if os.IsNotExist(err) {
			slog.Debug("Settings file not found, returning default empty settings", slog.String("filename", filename))
			return settings, nil
		}
		slog.Error("Failed to read settings file from disk", slog.String("filename", filename), slog.Any("error", err))
		return settings, err
	}

	err = json.Unmarshal(data, &settings)
	if err != nil {
		slog.Error("Failed to unmarshal settings JSON data", slog.String("filename", filename), slog.Any("error", err))
		return settings, err
	}

	slog.Debug("Successfully loaded application settings", slog.String("filename", filename))
	return settings, nil
}

// SaveSettings securely writes global settings using Atomic Write
func SaveSettings(filename string, settings AppSettings) error {
	slog.Debug("Attempting to save application settings", slog.String("filename", filename))

	settingsMu.Lock()
	defer settingsMu.Unlock()

	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		slog.Error("Failed to marshal settings to JSON", slog.Any("error", err))
		return err
	}

	// ATOMIC WRITE: Sistem çökse bile ayarların bozulmasını engeller
	tmpFile := filename + ".tmp"
	if err := os.WriteFile(tmpFile, data, 0644); err != nil {
		slog.Error("Failed to write settings to temporary file (Atomic Write Phase 1)",
			slog.String("tmp_file", tmpFile),
			slog.Any("error", err),
		)
		return err
	}

	if err := os.Rename(tmpFile, filename); err != nil {
		slog.Error("Failed to rename temporary file (Atomic Write Phase 2)",
			slog.String("tmp_file", tmpFile),
			slog.String("target_file", filename),
			slog.Any("error", err),
		)
		return err
	}

	slog.Debug("Successfully saved application settings via Atomic Write", slog.String("filename", filename))
	return nil
}
