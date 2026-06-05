package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"

	"github.com/Diony-source/DionyHub/internal/config"
	"github.com/Diony-source/DionyHub/internal/osutil"
)

func (s *Server) handleBrowseFolder(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		slog.Warn("Invalid HTTP method for browse folder", slog.String("method", r.Method))
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	slog.Debug("Opening native OS folder picker dialogue")
	path, err := osutil.PickFolder()
	if err != nil || path == "" {
		slog.Debug("Folder picker dialogue cancelled or failed", slog.Any("error", err))
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"path": ""}`))
		return
	}

	cleanPath := strings.ReplaceAll(path, "\\", "/")
	slog.Info("Folder successfully selected via native picker", slog.String("path", cleanPath))

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"path": cleanPath})
}

func (s *Server) handleSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		slog.Debug("Fetching system settings")
		settings, err := config.LoadSettings("app_config.json")
		if err != nil {
			slog.Error("Failed to load settings from disk", slog.Any("error", err))
			http.Error(w, `{"error": "Failed to load settings"}`, http.StatusInternalServerError)
			return
		}
		slog.Debug("Successfully retrieved system settings")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(settings)
		return
	}

	if r.Method == http.MethodPost {
		var newSettings config.AppSettings
		if err := json.NewDecoder(r.Body).Decode(&newSettings); err != nil {
			slog.Warn("Failed to decode settings payload", slog.Any("error", err))
			http.Error(w, `{"error": "Invalid JSON configuration"}`, http.StatusBadRequest)
			return
		}

		slog.Info("Updating system settings", slog.String("workspace", newSettings.Workspace))

		oldSettings, _ := config.LoadSettings("app_config.json")
		newSettings.SavedTags = oldSettings.SavedTags

		newSettings.Workspace = strings.TrimSpace(newSettings.Workspace)
		newSettings.Workspace = strings.ReplaceAll(newSettings.Workspace, "\u202A", "")
		newSettings.Workspace = strings.ReplaceAll(newSettings.Workspace, "\u202C", "")
		newSettings.Workspace = strings.ReplaceAll(newSettings.Workspace, "\\", "/")
		newSettings.GlobalEnv = strings.TrimSpace(newSettings.GlobalEnv)

		if err := config.SaveSettings("app_config.json", newSettings); err != nil {
			slog.Error("System Error -> Failed to save settings to disk", slog.Any("error", err))
			http.Error(w, `{"error": "Failed to save configuration to disk"}`, http.StatusInternalServerError)
			return
		}

		slog.Info("System Settings -> Global configuration updated successfully")

		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"message": "Settings saved successfully"}`))
		return
	}

	slog.Warn("Invalid HTTP method for settings", slog.String("method", r.Method))
	http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
}

func (s *Server) handleManageTag(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		slog.Warn("Invalid HTTP method for manage tag", slog.String("method", r.Method))
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		OriginalTag string   `json:"original_tag"`
		NewTag      string   `json:"new_tag"`
		ProjectIDs  []string `json:"project_ids"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		slog.Warn("Failed to decode manage tag payload", slog.Any("error", err))
		http.Error(w, `{"error": "Invalid request payload"}`, http.StatusBadRequest)
		return
	}

	req.OriginalTag = strings.TrimSpace(req.OriginalTag)
	req.NewTag = strings.TrimSpace(req.NewTag)

	slog.Info("Managing tags",
		slog.String("original_tag", req.OriginalTag),
		slog.String("new_tag", req.NewTag),
		slog.Int("affected_projects", len(req.ProjectIDs)),
	)

	settings, err := config.LoadSettings("app_config.json")
	if err == nil {
		var newSavedTags []string
		tagExists := false

		for _, t := range settings.SavedTags {
			if t == req.OriginalTag {
				continue
			}
			if t == req.NewTag {
				tagExists = true
			}
			newSavedTags = append(newSavedTags, t)
		}

		if req.NewTag != "" && !tagExists {
			newSavedTags = append(newSavedTags, req.NewTag)
		}

		settings.SavedTags = newSavedTags
		if err := config.SaveSettings("app_config.json", settings); err != nil {
			slog.Error("Failed to update saved tags in settings", slog.Any("error", err))
		} else {
			slog.Debug("Saved tags configuration successfully updated in settings")
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	targetMap := make(map[string]bool)
	for _, id := range req.ProjectIDs {
		targetMap[id] = true
	}

	for i, p := range s.projects {
		if targetMap[p.ID] {
			s.projects[i].Tag = req.NewTag
		} else if req.OriginalTag != "" && p.Tag == req.OriginalTag {
			s.projects[i].Tag = ""
		}
	}

	if err := config.SaveProjects("config.json", s.projects); err != nil {
		slog.Error("Failed to save projects after tag update", slog.Any("error", err))
	} else {
		slog.Info("Project tags updated and saved successfully")
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "Tag konfigürasyonu başarıyla kaydedildi"})
}
