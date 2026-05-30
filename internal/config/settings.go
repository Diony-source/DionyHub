package config

import (
	"encoding/json"
	"os"
	"sync"
)

var settingsMu sync.Mutex

// AppSettings represents the global configuration for DionyHub
type AppSettings struct {
	Workspace string `json:"workspace"`
	LogBuffer bool   `json:"log_buffer"` // İlerisi için ayırdığımız telemetry ayarı
}

// LoadSettings reads the global settings from the given JSON file.
func LoadSettings(filename string) (AppSettings, error) {
	settingsMu.Lock()
	defer settingsMu.Unlock()

	data, err := os.ReadFile(filename)
	if err != nil {
		if os.IsNotExist(err) {
			// Dosya yoksa varsayılan ayarları dön
			return AppSettings{
				Workspace: "C:/DionyHub/apps",
				LogBuffer: true,
			}, nil
		}
		return AppSettings{}, err
	}

	var s AppSettings
	if err := json.Unmarshal(data, &s); err != nil {
		return AppSettings{}, err
	}
	return s, nil
}

// SaveSettings writes the global settings to the given JSON file safely.
func SaveSettings(filename string, s AppSettings) error {
	settingsMu.Lock()
	defer settingsMu.Unlock()

	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(filename, data, 0644)
}
