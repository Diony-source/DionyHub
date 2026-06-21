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
	"github.com/Diony-source/DionyHub/internal/detector"
)

// YANLIŞLIKLA SİLDİĞİM O KRİTİK VERİ YAPISI (DTO) BURADA!
// Bu yapı arayüzün "Loading..." hatasını çözen yapıdır.
type ProjectResponse struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	Path         string  `json:"path"`
	Command      string  `json:"command"`
	Tag          string  `json:"tag"`
	Interactive  bool    `json:"interactive"`
	AutoStart    bool    `json:"auto_start"`
	AutoRestart  bool    `json:"auto_restart"`
	AutoClose    bool    `json:"auto_close"`
	ClearOnStart bool    `json:"clear_on_start"`
	Source       string  `json:"source"`
	Order        int     `json:"order"`
	Status       string  `json:"status"`
	CPU          float64 `json:"cpu"`
	RAM          float64 `json:"ram"`
}

// Güvenli veri dönüştürücümüz (Arayüze giden veriyi düzleştirir)
func toProjectResponse(p config.Project, status string, cpu, ram float64) ProjectResponse {
	return ProjectResponse{
		ID:           p.ID,
		Name:         p.Name,
		Path:         p.Path,
		Command:      p.Command,
		Tag:          p.Tag,
		Interactive:  p.Interactive,
		AutoStart:    p.AutoStart,
		AutoRestart:  p.AutoRestart,
		AutoClose:    p.AutoClose,
		ClearOnStart: p.ClearOnStart,
		Source:       p.Source,
		Order:        p.Order,
		Status:       status,
		CPU:          cpu,
		RAM:          ram,
	}
}

// Arka plan işçisini veritabanı ile senkronize eden köprümüz
func (s *Server) syncMemory() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if dbProjects, err := s.db.GetProjects(); err == nil {
		s.projects = dbProjects
	}
}

// YENİ: Zeka Motoru (Dedektif) Uç Noktası
func (s *Server) handleDetectProject(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	targetPath := r.URL.Query().Get("path")
	if targetPath == "" {
		http.Error(w, `{"error": "Path parameter is required"}`, http.StatusBadRequest)
		return
	}

	slog.Debug("Processing smart detection request", slog.String("path", targetPath))

	// Klasörü analiz edip sonucu JSON olarak arayüze gönderiyoruz
	result := detector.AnalyzePath(targetPath)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (s *Server) handleGetProjects(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		slog.Warn("Invalid HTTP method for getting projects", slog.String("method", r.Method))
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	s.syncMemory()

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

		response = append(response, toProjectResponse(p, status, cpu, ram))
	}

	w.Header().Set("Content-Type", "application/json")
	if len(response) == 0 {
		w.Write([]byte(`[]`))
		return
	}
	json.NewEncoder(w).Encode(response)
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

	cleanPath := strings.TrimSpace(req.Path)
	cleanPath = strings.ReplaceAll(cleanPath, "\u202A", "")
	cleanPath = strings.ReplaceAll(cleanPath, "\u202C", "")
	cleanPath = strings.ReplaceAll(cleanPath, "\\", "/")
	req.Tag = strings.TrimSpace(req.Tag)
	req.ID = strings.TrimSpace(req.ID)

	if req.ID == "" || req.Name == "" || cleanPath == "" {
		slog.Warn("Missing required fields in update project request", slog.String("project_id", req.ID))
		http.Error(w, `{"error": "ID, Name, and Path are required"}`, http.StatusBadRequest)
		return
	}

	envFile := filepath.Join(cleanPath, ".env")
	if req.DeleteEnv {
		os.Remove(envFile)
	} else if req.CreateEnv {
		os.WriteFile(envFile, []byte(req.InitialEnv), 0644)
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

	s.syncMemory()
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
		http.Error(w, `{"error": "Invalid JSON body"}`, http.StatusBadRequest)
		return
	}

	cleanPath := strings.TrimSpace(req.Path)
	cleanPath = strings.ReplaceAll(cleanPath, "\u202A", "")
	cleanPath = strings.ReplaceAll(cleanPath, "\u202C", "")
	cleanPath = strings.ReplaceAll(cleanPath, "\\", "/")

	if req.Name == "" || cleanPath == "" || req.Command == "" {
		http.Error(w, `{"error": "Name, Path, and Command are required"}`, http.StatusBadRequest)
		return
	}

	if req.CreateEnv {
		envPath := filepath.Join(cleanPath, ".env")
		os.WriteFile(envPath, []byte(req.InitialEnv), 0644)
	}

	newID := fmt.Sprintf("%d", time.Now().UnixMilli())

	query := `INSERT INTO projects (id, name, path, command, interactive, auto_start, auto_restart, auto_close, clear_on_start, source, order_index) 
	          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT IFNULL(MAX(order_index), 0) + 1 FROM projects))`
	_, err := s.db.DB.Exec(query, newID, req.Name, cleanPath, req.Command, req.Interactive, req.AutoStart, req.AutoRestart, req.AutoClose, req.ClearOnStart, "local")

	if err != nil {
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

	s.syncMemory()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)

	p, _ := s.db.GetProjectByID(newID)
	json.NewEncoder(w).Encode(toProjectResponse(p, "stopped", 0, 0))
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
		http.Error(w, `{"error": "Invalid JSON payload"}`, http.StatusBadRequest)
		return
	}

	req.RepoURL = strings.TrimSpace(req.RepoURL)
	if req.RepoURL == "" {
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
		http.Error(w, fmt.Sprintf(`{"error": "Folder '%s' already exists in your workspace!"}`, repoName), http.StatusBadRequest)
		return
	}

	cmd := exec.Command("git", "clone", req.RepoURL, destPath)
	output, err := cmd.CombinedOutput()
	if err != nil {
		safeErr := strings.ReplaceAll(string(output), "\n", " ")
		safeErr = strings.ReplaceAll(safeErr, "\"", "'")
		if safeErr == "" {
			safeErr = err.Error()
		}
		http.Error(w, fmt.Sprintf(`{"error": "Git Clone Failed: %s"}`, safeErr), http.StatusInternalServerError)
		return
	}

	if req.CreateEnv {
		envPath := filepath.Join(destPath, ".env")
		os.WriteFile(envPath, []byte(req.InitialEnv), 0644)
	}

	newID := fmt.Sprintf("%d", time.Now().UnixMilli())

	query := `INSERT INTO projects (id, name, path, command, interactive, auto_start, auto_restart, auto_close, clear_on_start, source, order_index) 
	          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT IFNULL(MAX(order_index), 0) + 1 FROM projects))`
	_, err = s.db.DB.Exec(query, newID, repoName, destPath, req.Command, req.Interactive, req.AutoStart, req.AutoRestart, req.AutoClose, req.ClearOnStart, "github")

	if err != nil {
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

	s.syncMemory()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)

	p, _ := s.db.GetProjectByID(newID)
	json.NewEncoder(w).Encode(toProjectResponse(p, "stopped", 0, 0))
}

func (s *Server) handleDeleteProject(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	id := strings.TrimSpace(r.URL.Query().Get("id"))
	removeFiles := r.URL.Query().Get("remove_files") == "true"

	if id == "" {
		http.Error(w, `{"error": "Missing project ID"}`, http.StatusBadRequest)
		return
	}

	targetProject, err := s.db.GetProjectByID(id)
	if err != nil {
		slog.Warn("Delete requested for unknown project", slog.String("project_id", id), slog.Any("error", err))
		http.Error(w, `{"error": "Project not found"}`, http.StatusNotFound)
		return
	}

	if s.manager.IsRunning(id) {
		_ = s.manager.Stop(id)
	}

	if removeFiles && targetProject.Source == "github" {
		os.RemoveAll(targetProject.Path)
	}

	_, err = s.db.DB.Exec(`DELETE FROM projects WHERE id=?`, id)
	if err != nil {
		http.Error(w, `{"error": "Database delete failed"}`, http.StatusInternalServerError)
		return
	}

	s.syncMemory()
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
		http.Error(w, `{"error": "Invalid request payload"}`, http.StatusBadRequest)
		return
	}

	deletedCount := 0
	for _, rawID := range req.IDs {
		id := strings.TrimSpace(rawID)
		target, err := s.db.GetProjectByID(id)
		if err != nil {
			continue
		}

		if s.manager.IsRunning(id) {
			_ = s.manager.Stop(id)
		}

		if req.RemoveFiles && target.Source == "github" {
			os.RemoveAll(target.Path)
		}

		_, err = s.db.DB.Exec(`DELETE FROM projects WHERE id=?`, id)
		if err == nil {
			deletedCount++
		}
	}

	s.syncMemory()

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
		http.Error(w, `{"error": "Invalid JSON array for ordering"}`, http.StatusBadRequest)
		return
	}

	tx, err := s.db.DB.Begin()
	if err != nil {
		http.Error(w, `{"error": "Failed to start transaction"}`, http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	for index, rawID := range newOrderIDs {
		id := strings.TrimSpace(rawID)
		_, err := tx.Exec(`UPDATE projects SET order_index = ? WHERE id = ?`, index, id)
		if err != nil {
			http.Error(w, `{"error": "Failed to reorder projects"}`, http.StatusInternalServerError)
			return
		}
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, `{"error": "Failed to save reordered projects"}`, http.StatusInternalServerError)
		return
	}

	s.syncMemory()
	w.WriteHeader(http.StatusOK)
}

func (s *Server) handleStartProject(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	id := strings.TrimSpace(r.URL.Query().Get("id"))

	target, err := s.db.GetProjectByID(id)
	if err != nil {
		slog.Error("Start request failed: Database lookup error", slog.String("project_id", id), slog.Any("error", err))
		http.Error(w, `{"error": "Project not found"}`, http.StatusNotFound)
		return
	}

	if target.ClearOnStart {
		logPath := filepath.Join(target.Path, "dionyhub_log", "output.log")
		os.WriteFile(logPath, []byte(""), 0666)
		wsMsg, _ := json.Marshal(map[string]string{"id": target.ID, "action": "clear"})
		s.broadcaster.Write(wsMsg)
	}

	parts := strings.Fields(target.Command)
	if len(parts) == 0 {
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

	w.WriteHeader(http.StatusOK)
}

func (s *Server) handleStopProject(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	id := strings.TrimSpace(r.URL.Query().Get("id"))
	if err := s.manager.Stop(id); err != nil {
		http.Error(w, fmt.Sprintf(`{"error": "%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func (s *Server) handleStartBulk(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var ids []string
	if err := json.NewDecoder(r.Body).Decode(&ids); err != nil {
		http.Error(w, `{"error": "Invalid JSON array"}`, http.StatusBadRequest)
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

	startedCount := 0
	for _, rawID := range ids {
		id := strings.TrimSpace(rawID)
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
			}
		}
	}

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
		http.Error(w, `{"error": "Invalid JSON array"}`, http.StatusBadRequest)
		return
	}

	stoppedCount := 0
	for _, rawID := range ids {
		id := strings.TrimSpace(rawID)
		if err := s.manager.Stop(id); err == nil {
			stoppedCount++
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": fmt.Sprintf("Successfully stopped %d project(s)", stoppedCount)})
}

func (s *Server) handleProjectEnv(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.URL.Query().Get("id"))
	if id == "" {
		http.Error(w, `{"error": "Missing project ID"}`, http.StatusBadRequest)
		return
	}

	target, err := s.db.GetProjectByID(id)
	if err != nil {
		http.Error(w, `{"error": "Project not found"}`, http.StatusNotFound)
		return
	}

	envFile := filepath.Join(target.Path, ".env")

	if r.Method == http.MethodGet {
		content, err := os.ReadFile(envFile)
		if err != nil {
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
			http.Error(w, `{"error": "Invalid request body"}`, http.StatusBadRequest)
			return
		}

		if req.DeleteEnv {
			os.Remove(envFile)
		} else {
			os.WriteFile(envFile, []byte(req.Content), 0644)
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

	id := strings.TrimSpace(r.URL.Query().Get("id"))
	if id == "" {
		http.Error(w, `{"error": "Missing project ID"}`, http.StatusBadRequest)
		return
	}

	targetProject, err := s.db.GetProjectByID(id)
	if err != nil {
		http.Error(w, `{"error": "Project not found"}`, http.StatusNotFound)
		return
	}

	settings, err := config.LoadSettings("app_config.json")
	if err != nil || settings.Workspace == "" {
		settings.Workspace = "C:/DionyHub/apps"
	}

	backupDir := filepath.Join(settings.Workspace, "DionyHub_Backups")
	os.MkdirAll(backupDir, 0755)

	timestamp := time.Now().Format("2006-01-02_15-04-05")
	safeName := strings.ReplaceAll(targetProject.Name, " ", "_")
	zipFileName := fmt.Sprintf("%s_backup_%s.zip", safeName, timestamp)
	targetZipPath := filepath.Join(backupDir, zipFileName)

	if err := archive.ZipDirectory(targetProject.Path, targetZipPath); err != nil {
		http.Error(w, `{"error": "Failed to create zip archive"}`, http.StatusInternalServerError)
		return
	}

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
		http.Error(w, `{"error": "Invalid JSON body"}`, http.StatusBadRequest)
		return
	}

	if err := s.manager.WriteInput(req.ID, req.Data); err != nil {
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

	id := strings.TrimSpace(r.URL.Query().Get("id"))
	if id == "" {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"logs": ""}`))
		return
	}

	var logPath string
	if id == "system" {
		logPath = "dionyhub_system.log"
	} else {
		target, err := s.db.GetProjectByID(id)
		if err != nil {
			http.Error(w, `{"error": "Project not found"}`, http.StatusNotFound)
			return
		}
		logPath = filepath.Join(target.Path, "dionyhub_log", "output.log")
	}

	content, err := os.ReadFile(logPath)
	if err != nil {
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
