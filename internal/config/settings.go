package config

import (
	"encoding/json"
	"log/slog"
	"os"
	"strings"
	"sync"
)

var settingsMu sync.Mutex

// AppSettings holds the global configuration for DionyHub
type AppSettings struct {
	Workspace    string              `json:"workspace"`
	Workspaces   []string            `json:"workspaces"`
	WorkspaceMap map[string][]string `json:"workspace_map"` // SANAL MASAÜSTÜ İZOLASYONU (Virtual Desktop -> Proje ID)
	LogBuffer    bool                `json:"log_buffer"`
	GlobalEnv    string              `json:"global_env"`
	SavedTags    []string            `json:"saved_tags"`
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
			return settings, nil
		}
		return settings, err
	}

	json.Unmarshal(data, &settings)

	// FİZİKSEL KLASÖRDEN SANAL WORKSPACE'E GEÇİŞ (MIGRATION)
	if len(settings.Workspaces) == 0 {
		settings.Workspaces = []string{"Workspace 1"}
		settings.Workspace = "Workspace 1"
	} else {
		if strings.Contains(settings.Workspaces[0], "/") || strings.Contains(settings.Workspaces[0], "\\") || settings.Workspaces[0] == "Masaüstü 1" {
			settings.Workspaces[0] = "Workspace 1"
		}
		if strings.Contains(settings.Workspace, "/") || strings.Contains(settings.Workspace, "\\") || settings.Workspace == "Masaüstü 1" {
			settings.Workspace = "Workspace 1"
		}
	}

	if settings.WorkspaceMap == nil {
		settings.WorkspaceMap = make(map[string][]string)
	}

	return settings, nil
}

// SaveSettings securely writes global settings using Atomic Write
func SaveSettings(filename string, settings AppSettings) error {
	settingsMu.Lock()
	defer settingsMu.Unlock()

	exists := false
	for _, w := range settings.Workspaces {
		if w == settings.Workspace {
			exists = true
			break
		}
	}
	if !exists && settings.Workspace != "" {
		settings.Workspaces = append(settings.Workspaces, settings.Workspace)
	}

	if settings.WorkspaceMap == nil {
		settings.WorkspaceMap = make(map[string][]string)
	}

	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}

	tmpFile := filename + ".tmp"
	if err := os.WriteFile(tmpFile, data, 0644); err != nil {
		return err
	}

	os.Rename(tmpFile, filename)
	return nil
}

// Yeni oluşturulan bir projeyi şu an aktif olan Sanal Workspace'e kalıcı olarak bağlar.
func AssignProjectToActiveWorkspace(projectID string) {
	settings, err := LoadSettings("app_config.json")
	if err != nil {
		return
	}

	activeWs := settings.Workspace
	if activeWs == "" {
		activeWs = "Workspace 1"
	}

	if settings.WorkspaceMap == nil {
		settings.WorkspaceMap = make(map[string][]string)
	}

	settings.WorkspaceMap[activeWs] = append(settings.WorkspaceMap[activeWs], projectID)
	SaveSettings("app_config.json", settings)
}
