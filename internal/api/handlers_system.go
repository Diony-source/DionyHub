package api

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/Diony-source/DionyHub/internal/config"
	"github.com/Diony-source/DionyHub/internal/osutil"
)

func (s *Server) handleBrowseFolder(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	path, err := osutil.PickFolder()
	if err != nil || path == "" {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"path": ""}`))
		return
	}

	cleanPath := strings.ReplaceAll(path, "\\", "/")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"path": cleanPath})
}

func (s *Server) handleSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		settings, err := config.LoadSettings("app_config.json")
		if err != nil {
			http.Error(w, `{"error": "Failed to load settings"}`, http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(settings)
		return
	}

	if r.Method == http.MethodPost {
		var newSettings config.AppSettings
		if err := json.NewDecoder(r.Body).Decode(&newSettings); err != nil {
			http.Error(w, `{"error": "Invalid JSON configuration"}`, http.StatusBadRequest)
			return
		}

		oldSettings, _ := config.LoadSettings("app_config.json")
		newSettings.SavedTags = oldSettings.SavedTags

		newSettings.Workspace = strings.TrimSpace(newSettings.Workspace)
		newSettings.Workspace = strings.ReplaceAll(newSettings.Workspace, "\u202A", "")
		newSettings.Workspace = strings.ReplaceAll(newSettings.Workspace, "\u202C", "")
		newSettings.Workspace = strings.ReplaceAll(newSettings.Workspace, "\\", "/")
		newSettings.GlobalEnv = strings.TrimSpace(newSettings.GlobalEnv)

		if err := config.SaveSettings("app_config.json", newSettings); err != nil {
			log.Printf("\x1b[36m[AUDIT]\x1b[0m \x1b[31mSystem Error\x1b[0m -> Failed to save settings: %v", err)
			http.Error(w, `{"error": "Failed to save configuration to disk"}`, http.StatusInternalServerError)
			return
		}

		log.Printf("\x1b[36m[AUDIT]\x1b[0m \x1b[35mSystem Settings\x1b[0m -> Global configuration updated successfully.")

		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"message": "Settings saved successfully"}`))
		return
	}
	http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
}

func (s *Server) handleManageTag(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		OriginalTag string   `json:"original_tag"`
		NewTag      string   `json:"new_tag"`
		ProjectIDs  []string `json:"project_ids"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error": "Invalid request payload"}`, http.StatusBadRequest)
		return
	}

	req.OriginalTag = strings.TrimSpace(req.OriginalTag)
	req.NewTag = strings.TrimSpace(req.NewTag)

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
		config.SaveSettings("app_config.json", settings)
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

	config.SaveProjects("config.json", s.projects)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "Tag konfigürasyonu başarıyla kaydedildi"})
}
