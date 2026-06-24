package api

import (
	"encoding/json"
	"fmt"
	"io"
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
	"github.com/Diony-source/DionyHub/internal/process"
)

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

func (s *Server) syncMemory() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if dbProjects, err := s.db.GetProjects(); err == nil {
		s.projects = dbProjects
	}
}

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
		tags := strings.Split(req.Tag, ",")
		for _, tName := range tags {
			tName = strings.TrimSpace(tName)
			if tName == "" {
				continue
			}
			s.db.DB.Exec("INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)", tName, "#6366f1")
			var tagID int
			if err := s.db.DB.QueryRow("SELECT id FROM tags WHERE name=?", tName).Scan(&tagID); err == nil {
				s.db.DB.Exec("INSERT OR IGNORE INTO project_tags (project_id, tag_id) VALUES (?, ?)", req.ID, tagID)
			}
		}
	}

	s.db.DB.Exec(`DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM project_tags)`)
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
		tags := strings.Split(req.Tag, ",")
		for _, tName := range tags {
			tName = strings.TrimSpace(tName)
			if tName == "" {
				continue
			}
			s.db.DB.Exec("INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)", tName, "#6366f1")
			var tagID int
			if err := s.db.DB.QueryRow("SELECT id FROM tags WHERE name=?", tName).Scan(&tagID); err == nil {
				s.db.DB.Exec("INSERT OR IGNORE INTO project_tags (project_id, tag_id) VALUES (?, ?)", newID, tagID)
			}
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

	newID := fmt.Sprintf("%d", time.Now().UnixMilli())

	query := `INSERT INTO projects (id, name, path, command, interactive, auto_start, auto_restart, auto_close, clear_on_start, source, order_index) 
	          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT IFNULL(MAX(order_index), 0) + 1 FROM projects))`
	_, err = s.db.DB.Exec(query, newID, repoName, destPath, req.Command, req.Interactive, req.AutoStart, req.AutoRestart, req.AutoClose, req.ClearOnStart, "github")

	if err != nil {
		http.Error(w, `{"error": "Failed to save project to DB"}`, http.StatusInternalServerError)
		return
	}

	if req.Tag != "" {
		tags := strings.Split(req.Tag, ",")
		for _, tName := range tags {
			tName = strings.TrimSpace(tName)
			if tName == "" {
				continue
			}
			s.db.DB.Exec("INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)", tName, "#6366f1")
			var tagID int
			if err := s.db.DB.QueryRow("SELECT id FROM tags WHERE name=?", tName).Scan(&tagID); err == nil {
				s.db.DB.Exec("INSERT OR IGNORE INTO project_tags (project_id, tag_id) VALUES (?, ?)", newID, tagID)
			}
		}
	}

	s.syncMemory()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	p, _ := s.db.GetProjectByID(newID)
	json.NewEncoder(w).Encode(toProjectResponse(p, "stopped", 0, 0))

	go func(projectID, targetPath, repoURL string, createEnv bool, initEnv string) {
		type WSLog struct {
			ID   string `json:"id"`
			Data string `json:"data"`
		}

		sendLog := func(data string) {
			msg, _ := json.Marshal(WSLog{ID: projectID, Data: data})
			s.broadcaster.Write(msg)
		}

		sendLog(fmt.Sprintf("\x1b[36m>>> Starting git clone from %s...\x1b[0m\r\n", repoURL))

		cmd := exec.Command("git", "clone", "--progress", repoURL, targetPath)
		stderr, pipeErr := cmd.StderrPipe()

		if pipeErr == nil {
			cmd.Start()
			buf := make([]byte, 1024)
			for {
				n, readErr := stderr.Read(buf)
				if n > 0 {
					sendLog(string(buf[:n]))
				}
				if readErr != nil {
					break
				}
			}
			err = cmd.Wait()
		} else {
			err = cmd.Run()
		}

		if err != nil {
			sendLog(fmt.Sprintf("\r\n\x1b[31m>>> Git clone failed: %v\x1b[0m\r\n", err))
		} else {
			sendLog("\r\n\x1b[32m>>> Git clone completed successfully!\x1b[0m\r\n")
			if createEnv {
				envPath := filepath.Join(targetPath, ".env")
				os.WriteFile(envPath, []byte(initEnv), 0644)
			}

			sendLog("\x1b[33m>>> Smart Detective analyzing the downloaded files...\x1b[0m\r\n")
			res := detector.AnalyzePath(targetPath)

			if res.Detected {
				sendLog(fmt.Sprintf("\x1b[32m>>> Detective found a %s project! Auto-configuring command: %s\x1b[0m\r\n", res.Language, res.Command))

				s.db.DB.Exec("UPDATE projects SET command = ? WHERE id = ?", res.Command, projectID)

				s.db.DB.Exec("INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)", res.Language, "#6366f1")
				var tagID int
				if err := s.db.DB.QueryRow("SELECT id FROM tags WHERE name=?", res.Language).Scan(&tagID); err == nil {
					s.db.DB.Exec("INSERT OR IGNORE INTO project_tags (project_id, tag_id) VALUES (?, ?)", projectID, tagID)
				}

				s.syncMemory()
				sendLog("\x1b[36m>>> Project is fully configured and ready.\x1b[0m\r\n")

				reloadMsg, _ := json.Marshal(map[string]string{"id": projectID, "action": "reload"})
				s.broadcaster.Write(reloadMsg)

			} else {
				sendLog("\x1b[31m>>> Detective could not determine project type. Please set the command manually.\x1b[0m\r\n")
			}
		}
	}(newID, destPath, req.RepoURL, req.CreateEnv, req.InitialEnv)
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
		settings, _ := config.LoadSettings("app_config.json")
		workspace := "C:/DionyHub/apps"
		if settings.Workspace != "" {
			workspace = settings.Workspace
		}
		cleanWorkspace := filepath.ToSlash(filepath.Clean(workspace))
		cleanTarget := filepath.ToSlash(filepath.Clean(targetProject.Path))

		if strings.HasPrefix(strings.ToLower(cleanTarget), strings.ToLower(cleanWorkspace)) && len(cleanTarget) > len(cleanWorkspace) {
			os.RemoveAll(targetProject.Path)
		} else {
			slog.Warn("Security Alert: Blocked attempt to delete folder outside of authorized workspace", slog.String("path", targetProject.Path))
		}
	}

	_, err = s.db.DB.Exec(`DELETE FROM projects WHERE id=?`, id)
	if err != nil {
		http.Error(w, `{"error": "Database delete failed"}`, http.StatusInternalServerError)
		return
	}

	s.db.DB.Exec(`DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM project_tags)`)
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

	settings, _ := config.LoadSettings("app_config.json")
	workspace := "C:/DionyHub/apps"
	if settings.Workspace != "" {
		workspace = settings.Workspace
	}
	cleanWorkspace := filepath.ToSlash(filepath.Clean(workspace))

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
			cleanTarget := filepath.ToSlash(filepath.Clean(target.Path))
			if strings.HasPrefix(strings.ToLower(cleanTarget), strings.ToLower(cleanWorkspace)) && len(cleanTarget) > len(cleanWorkspace) {
				os.RemoveAll(target.Path)
			} else {
				slog.Warn("Security Alert: Blocked bulk-delete folder outside workspace", slog.String("path", target.Path))
			}
		}

		_, err = s.db.DB.Exec(`DELETE FROM projects WHERE id=?`, id)
		if err == nil {
			deletedCount++
		}
	}

	s.db.DB.Exec(`DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM project_tags)`)
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

	// 🚨 ŞEFKATLİ PORT DEDEKTİFİ
	forceStart := r.URL.Query().Get("force") == "true"
	envFile := filepath.Join(target.Path, ".env")
	if envContent, err := os.ReadFile(envFile); err == nil {
		port := process.ExtractPortFromEnv(string(envContent))
		if port != "" {
			pid, pName, err := process.GetProcessByPort(port)
			if err == nil && pid > 0 {
				if forceStart {
					slog.Info("Port Guardian resolving conflict forcibly", slog.Int("pid", pid), slog.String("name", pName))
					process.ForceKill(pid)
					time.Sleep(800 * time.Millisecond)
				} else {
					slog.Warn("Port conflict detected", slog.String("port", port), slog.Int("pid", pid))
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusConflict)
					json.NewEncoder(w).Encode(map[string]interface{}{
						"error":        "port_conflict",
						"port":         port,
						"process_name": pName,
						"pid":          pid,
					})
					return
				}
			}
		}
	}

	parts := strings.Fields(target.Command)
	if len(parts) == 0 {
		http.Error(w, `{"error": "Invalid command configuration"}`, http.StatusInternalServerError)
		return
	}

	// --- 🚀 YENİ EKLENEN: UÇUŞ ÖNCESİ DONANIM KONTROLÜ (PRE-FLIGHT CHECK) ---
	binary := parts[0]
	if _, err := exec.LookPath(binary); err != nil {
		slog.Warn("Pre-flight check failed: binary not found", slog.String("binary", binary))
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusFailedDependency) // 424 Failed Dependency
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":  "missing_dependency",
			"binary": binary,
		})
		return
	}

	if target.ClearOnStart {
		logPath := filepath.Join(target.Path, "dionyhub_log", "output.log")
		os.MkdirAll(filepath.Dir(logPath), 0755)
		os.WriteFile(logPath, []byte(""), 0666)
		wsMsg, _ := json.Marshal(map[string]string{"id": target.ID, "action": "clear"})
		s.broadcaster.Write(wsMsg)
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

		parts := strings.Fields(target.Command)
		if len(parts) > 0 {
			// YENİ EKLENEN: Toplu Başlatmada Pre-flight Check (Yüklü değilse direkt atlar, sistemi kitlemez)
			if _, err := exec.LookPath(parts[0]); err == nil {
				if target.ClearOnStart {
					logPath := filepath.Join(target.Path, "dionyhub_log", "output.log")
					os.MkdirAll(filepath.Dir(logPath), 0755)
					os.WriteFile(logPath, []byte(""), 0666)
					wsMsg, _ := json.Marshal(map[string]string{"id": target.ID, "action": "clear"})
					s.broadcaster.Write(wsMsg)
				}

				if err := s.manager.Start(target.ID, target.Name, target.Path, target.Interactive, target.AutoRestart, globalEnvs, parts[0], parts[1:]...); err == nil {
					startedCount++
				}
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

	file, err := os.Open(logPath)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"logs": ""}`))
		return
	}
	defer file.Close()

	stat, err := file.Stat()
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"logs": ""}`))
		return
	}

	var size int64 = 15000
	if stat.Size() < size {
		size = stat.Size()
	}

	_, err = file.Seek(-size, io.SeekEnd)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"logs": ""}`))
		return
	}

	buf := make([]byte, size)
	n, _ := io.ReadFull(file, buf)

	strContent := string(buf[:n])

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"logs": strContent})
}

// --- YENİ EKLENEN VİZYON: IDE KÖPRÜSÜ (VS CODE) ---
func (s *Server) handleOpenVSCode(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	id := strings.TrimSpace(r.URL.Query().Get("id"))
	if id == "" {
		http.Error(w, `{"error": "Missing project ID"}`, http.StatusBadRequest)
		return
	}

	target, err := s.db.GetProjectByID(id)
	if err != nil {
		slog.Warn("VS Code open requested for unknown project", slog.String("project_id", id), slog.Any("error", err))
		http.Error(w, `{"error": "Project not found"}`, http.StatusNotFound)
		return
	}

	// Arka planda VS Code'u hedef dizinde başlatır
	cmd := exec.Command("code", ".")
	cmd.Dir = target.Path

	err = cmd.Start()
	if err != nil {
		slog.Error("Failed to open VS Code", slog.String("path", target.Path), slog.Any("error", err))
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{
			"error": "VS Code başlatılamadı. 'code' komutunun PATH'te olduğundan emin olun.",
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"message": "VS Code başarıyla başlatıldı",
	})
}
