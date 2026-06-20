package api

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/Diony-source/DionyHub/internal/archive"
	"github.com/Diony-source/DionyHub/internal/config"
)

type ProjectResponse struct {
	config.Project
	CPU float64 `json:"cpu"`
	RAM float64 `json:"ram"`
}

// YENİ VE KRİTİK: Veritabanındaki güncel durumu, arka plan WebSocket işçisinin
// (metrics.go) taradığı bellek listesine (s.projects) kopyalayan köprü.
func (s *Server) syncMemory() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if dbProjects, err := s.db.GetProjects(); err == nil {
		s.projects = dbProjects
	}
}

func (s *Server) handleGetProjects(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		slog.Warn("Invalid HTTP method for getting projects", slog.String("method", r.Method))
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	// İlk istek geldiğinde işçinin belleğini hemen güncelliyoruz
	s.syncMemory()

	slog.Debug("Fetching all projects from SQLite database and compiling live stats")

	dbProjects, err := s.db.GetProjects()
	if err != nil {
		slog.Error("Failed to fetch projects from database", slog.Any("error", err))
		http.Error(w, `{"error": "Database error"}`, http.StatusInternalServerError)
		return
	}

	var response []ProjectResponse
	for _, p := range dbProjects {
		status := "stopped"
		var cpu, ram float64

		if s.manager.IsRunning(p.ID) {
			status = "running"
			cpu, ram, _ = s.manager.GetStats(p.ID)

			if math.IsNaN(cpu) || math.IsInf(cpu, 0) {
				cpu = 0
			}
			if math.IsNaN(ram) || math.IsInf(ram, 0) {
				ram = 0
			}
		}

		p.Status = status

		pr := ProjectResponse{
			Project: p,
			CPU:     cpu,
			RAM:     ram,
		}
		response = append(response, pr)
	}

	w.Header().Set("Content-Type", "application/json")
	if len(response) == 0 {
		w.Write([]byte(`[]`))
		return
	}
	json.NewEncoder(w).Encode(response)
	slog.Debug("Successfully returned projects list to UI", slog.Int("count", len(response)))
}

func (s *Server) handleUpdateProject(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ID           string `json:"id"`
		Name         string `json:"name"`
		Path         string `json:"path"`
		Command      string `json:"command"`
		Tag          string `json:"tag"`
		Interactive  bool   `json:"interactive"`
		AutoStart    bool   `json:"auto_start"`
		AutoRestart  bool   `json:"auto_restart"`
		AutoClose    bool   `json:"auto_close"`
		ClearOnStart bool   `json:"clear_on_start"`
		InitialEnv   string `json:"initial_env"`
		CreateEnv    bool   `json:"create_env"`
		DeleteEnv    bool   `json:"delete_env"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		slog.Warn("Failed to decode update project request payload", slog.Any("error", err))
		http.Error(w, `{"error": "Invalid JSON body"}`, http.StatusBadRequest)
		return
	}

	slog.Info("Updating project configuration", slog.String("project_id", req.ID), slog.String("project_name", req.Name))

	cleanPath := strings.TrimSpace(req.Path)
	cleanPath = strings.ReplaceAll(cleanPath, "\u202A", "")
	cleanPath = strings.ReplaceAll(cleanPath, "\u202C", "")
	cleanPath = strings.ReplaceAll(cleanPath, "\\", "/")
	req.Tag = strings.TrimSpace(req.Tag)

	if req.ID == "" || req.Name == "" || cleanPath == "" {
		slog.Warn("Missing required fields in update project request", slog.String("project_id", req.ID))
		http.Error(w, `{"error": "ID, Name, and Path are required"}`, http.StatusBadRequest)
		return
	}

	envFile := filepath.Join(cleanPath, ".env")
	if req.DeleteEnv {
		os.Remove(envFile)
		slog.Debug("Removed environment file for project", slog.String("project_id", req.ID))
	} else if req.CreateEnv {
		os.WriteFile(envFile, []byte(req.InitialEnv), 0644)
		slog.Debug("Updated environment file for project", slog.String("project_id", req.ID))
	}

	query := `UPDATE projects SET name=?, path=?, command=?, interactive=?, auto_start=?, auto_restart=?, auto_close=?, clear_on_start=? WHERE id=?`
	_, err := s.db.DB.Exec(query, req.Name, cleanPath, req.Command, req.Interactive, req.AutoStart, req.AutoRestart, req.AutoClose, req.ClearOnStart, req.ID)
	if err != nil {
		slog.Error("Failed to update project in DB", slog.Any("error", err))
		http.Error(w, `{"error": "Failed to update project database"}`, http.StatusInternalServerError)
		return
	}

	s.db.DB.Exec(`DELETE FROM project_tags WHERE project_id=?`, req.ID)
	if req.Tag != "" {
		s.db.DB.Exec("INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)", req.Tag, "#6366f1")
		var tagID int
		if err := s.db.DB.QueryRow("SELECT id FROM tags WHERE name=?", req.Tag).Scan(&tagID); err == nil {
			s.db.DB.Exec("INSERT OR IGNORE INTO project_tags (project_id, tag_id) VALUES (?, ?)", req.ID, tagID)
		}
	}

	// Güncellemeden sonra belleği senkronize et
	s.syncMemory()

	slog.Info("Project successfully updated and saved to DB", slog.String("project_id", req.ID))
	w.WriteHeader(http.StatusOK)
}

func (s *Server) handleAddProject(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Name         string `json:"name"`
		Path         string `json:"path"`
		Command      string `json:"command"`
		Tag          string `json:"tag"`
		Interactive  bool   `json:"interactive"`
		AutoStart    bool   `json:"auto_start"`
		AutoRestart  bool   `json:"auto_restart"`
		AutoClose    bool   `json:"auto_close"`
		ClearOnStart bool   `json:"clear_on_start"`
		InitialEnv   string `json:"initial_env"`
		CreateEnv    bool   `json:"create_env"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		slog.Warn("Failed to decode add project request payload", slog.Any("error", err))
		http.Error(w, `{"error": "Invalid JSON body"}`, http.StatusBadRequest)
		return
	}

	cleanPath := strings.TrimSpace(req.Path)
	cleanPath = strings.ReplaceAll(cleanPath, "\u202A", "")
	cleanPath = strings.ReplaceAll(cleanPath, "\u202C", "")
	cleanPath = strings.ReplaceAll(cleanPath, "\\", "/")

	if req.Name == "" || cleanPath == "" || req.Command == "" {
		slog.Warn("Missing required fields in add project request", slog.String("name", req.Name))
		http.Error(w, `{"error": "Name, Path, and Command are required"}`, http.StatusBadRequest)
		return
	}

	if req.CreateEnv {
		envPath := filepath.Join(cleanPath, ".env")
		os.WriteFile(envPath, []byte(req.InitialEnv), 0644)
		slog.Debug("Created environment file for new local project", slog.String("path", envPath))
	}

	newID := fmt.Sprintf("%d", time.Now().UnixMilli())

	query := `INSERT INTO projects (id, name, path, command, interactive, auto_start, auto_restart, auto_close, clear_on_start, source, order_index) 
	          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT IFNULL(MAX(order_index), 0) + 1 FROM projects))`
	_, err := s.db.DB.Exec(query, newID, req.Name, cleanPath, req.Command, req.Interactive, req.AutoStart, req.AutoRestart, req.AutoClose, req.ClearOnStart, "local")

	if err != nil {
		slog.Error("Failed to save new project to DB", slog.Any("error", err))
		http.Error(w, `{"error": "Database insert failed"}`, http.StatusInternalServerError)
		return
	}

	if req.Tag != "" {
		s.db.DB.Exec("INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)", req.Tag, "#6366f1")
		var tagID int
		if err := s.db.DB.QueryRow("SELECT id FROM tags WHERE name=?", req.Tag).Scan(&tagID); err == nil {
			s.db.DB.Exec("INSERT OR IGNORE INTO project_tags (project_id, tag_id) VALUES (?, ?)", newID, tagID)
		}
	}

	// Ekledikten sonra belleği senkronize et
	s.syncMemory()

	slog.Info("New local project created and saved to DB", slog.String("project_id", newID), slog.String("project_name", req.Name))

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	p, _ := s.db.GetProjectByID(newID)
	json.NewEncoder(w).Encode(p)
}

func (s *Server) handleCloneProject(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		RepoURL      string `json:"repo_url"`
		Command      string `json:"command"`
		Tag          string `json:"tag"`
		Interactive  bool   `json:"interactive"`
		AutoStart    bool   `json:"auto_start"`
		AutoRestart  bool   `json:"auto_restart"`
		AutoClose    bool   `json:"auto_close"`
		ClearOnStart bool   `json:"clear_on_start"`
		InitialEnv   string `json:"initial_env"`
		CreateEnv    bool   `json:"create_env"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		slog.Warn("Failed to decode clone project payload", slog.Any("error", err))
		http.Error(w, `{"error": "Invalid JSON payload"}`, http.StatusBadRequest)
		return
	}

	req.RepoURL = strings.TrimSpace(req.RepoURL)
	if req.RepoURL == "" {
		slog.Warn("Clone project request missing repository URL")
		http.Error(w, `{"error": "Repository URL is required"}`, http.StatusBadRequest)
		return
	}

	cleanURL := strings.TrimRight(req.RepoURL, "/")
	parts := strings.Split(cleanURL, "/")
	repoName := parts[len(parts)-1]
	repoName = strings.TrimSuffix(repoName, ".git")

	settings, err := config.LoadSettings("app_config.json")
	if err != nil || settings.Workspace == "" {
		settings.Workspace = "C:/DionyHub/apps"
	}

	cleanWorkspace := strings.ReplaceAll(settings.Workspace, "\u202A", "")
	cleanWorkspace = strings.ReplaceAll(cleanWorkspace, "\u202C", "")
	os.MkdirAll(cleanWorkspace, 0755)

	destPath := filepath.Join(cleanWorkspace, repoName)
	destPath = strings.ReplaceAll(destPath, "\\", "/")

	if _, err := os.Stat(destPath); !os.IsNotExist(err) {
		slog.Warn("Clone target directory already exists", slog.String("dest_path", destPath))
		http.Error(w, fmt.Sprintf(`{"error": "Folder '%s' already exists in your workspace!"}`, repoName), http.StatusBadRequest)
		return
	}

	slog.Info("Initiating git clone operation", slog.String("repo_url", req.RepoURL), slog.String("dest_path", destPath))
	cmd := exec.Command("git", "clone", req.RepoURL, destPath)
	output, err := cmd.CombinedOutput()
	if err != nil {
		slog.Error("Git clone execution failed", slog.String("repo_url", req.RepoURL), slog.Any("error", err), slog.String("output", string(output)))
		safeErr := strings.ReplaceAll(string(output), "\n", " ")
		safeErr = strings.ReplaceAll(safeErr, "\"", "'")
		if safeErr == "" {
			safeErr = err.Error()
		}
		http.Error(w, fmt.Sprintf(`{"error": "Git Clone Failed: %s"}`, safeErr), http.StatusInternalServerError)
		return
	}
	slog.Info("Git clone completed successfully", slog.String("repo_url", req.RepoURL))

	if req.CreateEnv {
		envPath := filepath.Join(destPath, ".env")
		os.WriteFile(envPath, []byte(req.InitialEnv), 0644)
		slog.Debug("Created environment file for cloned project", slog.String("path", envPath))
	}

	newID := fmt.Sprintf("%d", time.Now().UnixMilli())

	query := `INSERT INTO projects (id, name, path, command, interactive, auto_start, auto_restart, auto_close, clear_on_start, source, order_index) 
	          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT IFNULL(MAX(order_index), 0) + 1 FROM projects))`
	_, err = s.db.DB.Exec(query, newID, repoName, destPath, req.Command, req.Interactive, req.AutoStart, req.AutoRestart, req.AutoClose, req.ClearOnStart, "github")

	if err != nil {
		slog.Error("Failed to save cloned project configuration to DB", slog.Any("error", err))
		http.Error(w, `{"error": "Failed to save project to DB"}`, http.StatusInternalServerError)
		return
	}

	if req.Tag != "" {
		s.db.DB.Exec("INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)", req.Tag, "#6366f1")
		var tagID int
		if err := s.db.DB.QueryRow("SELECT id FROM tags WHERE name=?", req.Tag).Scan(&tagID); err == nil {
			s.db.DB.Exec("INSERT OR IGNORE INTO project_tags (project_id, tag_id) VALUES (?, ?)", newID, tagID)
		}
	}

	// Klonlamadan sonra belleği senkronize et
	s.syncMemory()

	slog.Info("Cloned project configured and saved to DB", slog.String("project_id", newID), slog.String("project_name", repoName))

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	p, _ := s.db.GetProjectByID(newID)
	json.NewEncoder(w).Encode(p)
}

func (s *Server) handleDeleteProject(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	id := r.URL.Query().Get("id")
	removeFiles := r.URL.Query().Get("remove_files") == "true"

	if id == "" {
		slog.Warn("Delete project requested without an ID")
		http.Error(w, `{"error": "Missing project ID"}`, http.StatusBadRequest)
		return
	}

	slog.Info("Initiating project deletion", slog.String("project_id", id), slog.Bool("remove_files", removeFiles))

	targetProject, err := s.db.GetProjectByID(id)
	if err != nil {
		slog.Warn("Attempted to delete a non-existent project", slog.String("project_id", id))
		http.Error(w, `{"error": "Project not found"}`, http.StatusNotFound)
		return
	}

	if s.manager.IsRunning(id) {
		slog.Debug("Stopping running project before deletion", slog.String("project_id", id))
		_ = s.manager.Stop(id)
	}

	if removeFiles && targetProject.Source == "github" {
		err := os.RemoveAll(targetProject.Path)
		if err != nil {
			slog.Error("Failed to remove project files from disk", slog.String("path", targetProject.Path), slog.Any("error", err))
		} else {
			slog.Info("Project files successfully removed from disk", slog.String("path", targetProject.Path))
		}
	}

	_, err = s.db.DB.Exec(`DELETE FROM projects WHERE id=?`, id)
	if err != nil {
		slog.Error("Failed to delete project from DB", slog.Any("error", err))
		http.Error(w, `{"error": "Database delete failed"}`, http.StatusInternalServerError)
		return
	}

	// Sildikten sonra belleği senkronize et
	s.syncMemory()

	slog.Info("Project successfully deleted from DB", slog.String("project_id", id))
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
}

func (s *Server) handleDeleteBulk(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		IDs         []string `json:"ids"`
		RemoveFiles bool     `json:"remove_files"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		slog.Warn("Failed to decode bulk delete request", slog.Any("error", err))
		http.Error(w, `{"error": "Invalid request payload"}`, http.StatusBadRequest)
		return
	}

	if len(req.IDs) == 0 {
		slog.Warn("Bulk delete requested with empty ID list")
		http.Error(w, `{"error": "No IDs provided"}`, http.StatusBadRequest)
		return
	}

	slog.Info("Initiating bulk deletion", slog.Int("project_count", len(req.IDs)), slog.Bool("remove_files", req.RemoveFiles))

	deletedCount := 0
	for _, id := range req.IDs {
		target, err := s.db.GetProjectByID(id)
		if err != nil {
			continue
		}

		if s.manager.IsRunning(id) {
			slog.Debug("Stopping project for bulk deletion", slog.String("project_id", id))
			_ = s.manager.Stop(id)
		}

		if req.RemoveFiles && target.Source == "github" {
			err := os.RemoveAll(target.Path)
			if err != nil {
				slog.Error("Failed to remove project files during bulk delete", slog.String("path", target.Path), slog.Any("error", err))
			} else {
				slog.Debug("Removed project files during bulk delete", slog.String("path", target.Path))
			}
		}

		_, err = s.db.DB.Exec(`DELETE FROM projects WHERE id=?`, id)
		if err == nil {
			deletedCount++
		}
	}

	// Sildikten sonra belleği senkronize et
	s.syncMemory()

	slog.Info("Bulk deletion completed via DB", slog.Int("deleted_count", deletedCount))

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": fmt.Sprintf("Successfully deleted %d projects", deletedCount)})
}

func (s *Server) handleReorderProjects(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var newOrderIDs []string
	if err := json.NewDecoder(r.Body).Decode(&newOrderIDs); err != nil {
		slog.Warn("Failed to decode project reorder request", slog.Any("error", err))
		http.Error(w, `{"error": "Invalid JSON array for ordering"}`, http.StatusBadRequest)
		return
	}

	slog.Debug("Processing project reorder request", slog.Int("provided_ids_count", len(newOrderIDs)))

	tx, err := s.db.DB.Begin()
	if err != nil {
		http.Error(w, `{"error": "Failed to start transaction"}`, http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	for index, id := range newOrderIDs {
		_, err := tx.Exec(`UPDATE projects SET order_index = ? WHERE id = ?`, index, id)
		if err != nil {
			slog.Error("Failed to update order in DB", slog.String("project_id", id), slog.Any("error", err))
			http.Error(w, `{"error": "Failed to reorder projects"}`, http.StatusInternalServerError)
			return
		}
	}

	if err := tx.Commit(); err != nil {
		slog.Error("Failed to commit reorder transaction", slog.Any("error", err))
		http.Error(w, `{"error": "Failed to save reordered projects"}`, http.StatusInternalServerError)
		return
	}

	// Sıralamadan sonra belleği senkronize et
	s.syncMemory()

	slog.Info("Projects reordered and saved successfully to DB")
	w.WriteHeader(http.StatusOK)
}

func (s *Server) handleStartProject(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	id := r.URL.Query().Get("id")

	target, err := s.db.GetProjectByID(id)
	if err != nil {
		slog.Warn("Start requested for unknown project", slog.String("project_id", id))
		http.Error(w, `{"error": "Project not found"}`, http.StatusNotFound)
		return
	}

	slog.Info("Starting project execution", slog.String("project_id", target.ID), slog.String("project_name", target.Name))

	if target.ClearOnStart {
		logPath := filepath.Join(target.Path, "dionyhub_log", "output.log")
		os.WriteFile(logPath, []byte(""), 0666)
		wsMsg, _ := json.Marshal(map[string]string{"id": target.ID, "action": "clear"})
		s.broadcaster.Write(wsMsg)
		slog.Debug("Cleared logs for project before starting", slog.String("project_id", target.ID))
	}

	parts := strings.Fields(target.Command)
	if len(parts) == 0 {
		slog.Error("Invalid or empty command configuration for project", slog.String("project_id", target.ID))
		http.Error(w, `{"error": "Invalid command configuration"}`, http.StatusInternalServerError)
		return
	}

	settings, _ := config.LoadSettings("app_config.json")
	var globalEnvs []string
	if settings.GlobalEnv != "" {
		lines := strings.Split(settings.GlobalEnv, "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line != "" && !strings.HasPrefix(line, "#") {
				globalEnvs = append(globalEnvs, line)
			}
		}
	}

	if err := s.manager.Start(target.ID, target.Name, target.Path, target.Interactive, target.AutoRestart, globalEnvs, parts[0], parts[1:]...); err != nil {
		slog.Error("Failed to start project execution", slog.String("project_id", target.ID), slog.Any("error", err))
		http.Error(w, fmt.Sprintf(`{"error": "%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	slog.Info("Project started successfully", slog.String("project_id", target.ID))
	w.WriteHeader(http.StatusOK)
}

func (s *Server) handleStopProject(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	id := r.URL.Query().Get("id")
	slog.Info("Stop command received for project", slog.String("project_id", id))

	if err := s.manager.Stop(id); err != nil {
		slog.Error("Failed to stop project", slog.String("project_id", id), slog.Any("error", err))
		http.Error(w, fmt.Sprintf(`{"error": "%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	slog.Info("Project stopped successfully", slog.String("project_id", id))
	w.WriteHeader(http.StatusOK)
}

func (s *Server) handleStartBulk(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var ids []string
	if err := json.NewDecoder(r.Body).Decode(&ids); err != nil {
		slog.Warn("Failed to decode bulk start request payload", slog.Any("error", err))
		http.Error(w, `{"error": "Invalid JSON array"}`, http.StatusBadRequest)
		return
	}

	slog.Info("Processing bulk start request", slog.Int("project_count", len(ids)))

	settings, _ := config.LoadSettings("app_config.json")
	var globalEnvs []string
	if settings.GlobalEnv != "" {
		lines := strings.Split(settings.GlobalEnv, "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line != "" && !strings.HasPrefix(line, "#") {
				globalEnvs = append(globalEnvs, line)
			}
		}
	}

	startedCount := 0
	for _, id := range ids {
		target, err := s.db.GetProjectByID(id)
		if err != nil {
			continue
		}

		if target.ClearOnStart {
			logPath := filepath.Join(target.Path, "dionyhub_log", "output.log")
			os.WriteFile(logPath, []byte(""), 0666)

			wsMsg, _ := json.Marshal(map[string]string{"id": target.ID, "action": "clear"})
			s.broadcaster.Write(wsMsg)
		}

		parts := strings.Fields(target.Command)
		if len(parts) > 0 {
			if err := s.manager.Start(target.ID, target.Name, target.Path, target.Interactive, target.AutoRestart, globalEnvs, parts[0], parts[1:]...); err == nil {
				startedCount++
				slog.Debug("Started project via bulk operation", slog.String("project_id", target.ID))
			} else {
				slog.Error("Failed to start project in bulk operation", slog.String("project_id", target.ID), slog.Any("error", err))
			}
		}
	}

	slog.Info("Bulk start completed", slog.Int("started_count", startedCount))

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": fmt.Sprintf("Successfully started %d project(s)", startedCount)})
}

func (s *Server) handleStopBulk(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var ids []string
	if err := json.NewDecoder(r.Body).Decode(&ids); err != nil {
		slog.Warn("Failed to decode bulk stop request payload", slog.Any("error", err))
		http.Error(w, `{"error": "Invalid JSON array"}`, http.StatusBadRequest)
		return
	}

	slog.Info("Processing bulk stop request", slog.Int("project_count", len(ids)))

	stoppedCount := 0
	for _, id := range ids {
		if err := s.manager.Stop(id); err == nil {
			stoppedCount++
			slog.Debug("Stopped project via bulk operation", slog.String("project_id", id))
		} else {
			slog.Error("Failed to stop project in bulk operation", slog.String("project_id", id), slog.Any("error", err))
		}
	}

	slog.Info("Bulk stop completed", slog.Int("stopped_count", stoppedCount))

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": fmt.Sprintf("Successfully stopped %d project(s)", stoppedCount)})
}

func (s *Server) handleProjectEnv(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		slog.Warn("Environment variable request missing project ID")
		http.Error(w, `{"error": "Missing project ID"}`, http.StatusBadRequest)
		return
	}

	slog.Debug("Processing project environment file request", slog.String("project_id", id), slog.String("method", r.Method))

	target, err := s.db.GetProjectByID(id)
	if err != nil {
		slog.Warn("Environment requested for unknown project", slog.String("project_id", id))
		http.Error(w, `{"error": "Project not found"}`, http.StatusNotFound)
		return
	}

	envFile := filepath.Join(target.Path, ".env")

	if r.Method == http.MethodGet {
		content, err := os.ReadFile(envFile)
		if err != nil {
			slog.Debug("No environment file found or readable for project", slog.String("project_id", id), slog.Any("error", err))
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"content": ""}`))
			return
		}

		response := map[string]string{"content": string(content)}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
		return
	}

	if r.Method == http.MethodPost {
		var req struct {
			Content   string `json:"content"`
			DeleteEnv bool   `json:"delete_env"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			slog.Warn("Failed to decode environment payload", slog.Any("error", err))
			http.Error(w, `{"error": "Invalid request body"}`, http.StatusBadRequest)
			return
		}

		if req.DeleteEnv {
			err := os.Remove(envFile)
			if err != nil {
				slog.Error("Failed to delete environment file", slog.String("project_id", id), slog.Any("error", err))
			} else {
				slog.Info("Environment file deleted for project", slog.String("project_id", id))
			}
		} else {
			err := os.WriteFile(envFile, []byte(req.Content), 0644)
			if err != nil {
				slog.Error("Failed to save environment file", slog.String("project_id", id), slog.Any("error", err))
			} else {
				slog.Info("Environment file saved for project", slog.String("project_id", id))
			}
		}
		w.WriteHeader(http.StatusOK)
		return
	}
}

func (s *Server) handleBackupProject(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	id := r.URL.Query().Get("id")
	if id == "" {
		slog.Warn("Backup requested without a project ID")
		http.Error(w, `{"error": "Missing project ID"}`, http.StatusBadRequest)
		return
	}

	slog.Info("Initiating backup process for project", slog.String("project_id", id))

	targetProject, err := s.db.GetProjectByID(id)
	if err != nil {
		slog.Warn("Backup requested for non-existent project", slog.String("project_id", id))
		http.Error(w, `{"error": "Project not found"}`, http.StatusNotFound)
		return
	}

	settings, err := config.LoadSettings("app_config.json")
	if err != nil || settings.Workspace == "" {
		slog.Debug("Using default workspace path for backup")
		settings.Workspace = "C:/DionyHub/apps"
	}

	backupDir := filepath.Join(settings.Workspace, "DionyHub_Backups")
	os.MkdirAll(backupDir, 0755)

	timestamp := time.Now().Format("2006-01-02_15-04-05")
	safeName := strings.ReplaceAll(targetProject.Name, " ", "_")
	zipFileName := fmt.Sprintf("%s_backup_%s.zip", safeName, timestamp)
	targetZipPath := filepath.Join(backupDir, zipFileName)

	if err := archive.ZipDirectory(targetProject.Path, targetZipPath); err != nil {
		slog.Error("Failed to create zip archive for backup", slog.String("project_id", id), slog.Any("error", err))
		http.Error(w, `{"error": "Failed to create zip archive"}`, http.StatusInternalServerError)
		return
	}

	slog.Info("Backup created successfully", slog.String("project_id", id), slog.String("archive", zipFileName))

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"message": fmt.Sprintf("Backup saved as %s", zipFileName),
	})
}

func (s *Server) handleProjectInput(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ID   string `json:"id"`
		Data string `json:"data"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		slog.Warn("Failed to decode project input payload", slog.Any("error", err))
		http.Error(w, `{"error": "Invalid JSON body"}`, http.StatusBadRequest)
		return
	}

	slog.Debug("Writing input to process stdin", slog.String("project_id", req.ID))

	if err := s.manager.WriteInput(req.ID, req.Data); err != nil {
		slog.Error("Failed to write input to process", slog.String("project_id", req.ID), slog.Any("error", err))
		http.Error(w, fmt.Sprintf(`{"error": "%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

func (s *Server) handleProjectLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	id := r.URL.Query().Get("id")
	if id == "" {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"logs": ""}`))
		return
	}

	slog.Debug("Fetching historical logs for terminal", slog.String("target_id", id))

	var logPath string

	if id == "system" {
		logPath = "dionyhub_system.log"
	} else {
		target, err := s.db.GetProjectByID(id)
		if err != nil {
			slog.Warn("Log fetch requested for unknown project", slog.String("project_id", id))
			http.Error(w, `{"error": "Project not found"}`, http.StatusNotFound)
			return
		}
		logPath = filepath.Join(target.Path, "dionyhub_log", "output.log")
	}

	content, err := os.ReadFile(logPath)
	if err != nil {
		slog.Debug("Log file unreadable or not found", slog.String("path", logPath))
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"logs": ""}`))
		return
	}

	strContent := string(content)
	if len(strContent) > 15000 {
		strContent = strContent[len(strContent)-15000:]
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"logs": strContent})
}
