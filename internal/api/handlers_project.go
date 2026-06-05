package api

import (
	"encoding/json"
	"fmt"
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

func (s *Server) handleGetProjects(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	s.mu.RLock()
	defer s.mu.RUnlock()

	var response []ProjectResponse
	for _, p := range s.projects {
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

		pr := ProjectResponse{
			Project: p,
			CPU:     cpu,
			RAM:     ram,
		}
		pr.Status = status
		response = append(response, pr)
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
		http.Error(w, `{"error": "Invalid JSON body"}`, http.StatusBadRequest)
		return
	}

	cleanPath := strings.TrimSpace(req.Path)
	cleanPath = strings.ReplaceAll(cleanPath, "\u202A", "")
	cleanPath = strings.ReplaceAll(cleanPath, "\u202C", "")
	cleanPath = strings.ReplaceAll(cleanPath, "\\", "/")
	req.Tag = strings.TrimSpace(req.Tag)

	if req.ID == "" || req.Name == "" || cleanPath == "" {
		http.Error(w, `{"error": "ID, Name, and Path are required"}`, http.StatusBadRequest)
		return
	}

	envFile := filepath.Join(cleanPath, ".env")
	if req.DeleteEnv {
		os.Remove(envFile)
	} else if req.CreateEnv {
		os.WriteFile(envFile, []byte(req.InitialEnv), 0644)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	found := false
	for i, p := range s.projects {
		if p.ID == req.ID {
			s.projects[i].Name = req.Name
			s.projects[i].Path = cleanPath
			s.projects[i].Command = req.Command
			s.projects[i].Interactive = req.Interactive
			s.projects[i].AutoStart = req.AutoStart
			s.projects[i].AutoRestart = req.AutoRestart
			s.projects[i].AutoClose = req.AutoClose
			s.projects[i].ClearOnStart = req.ClearOnStart
			s.projects[i].Tag = req.Tag
			found = true
			break
		}
	}

	if !found {
		http.Error(w, `{"error": "Project not found"}`, http.StatusNotFound)
		return
	}

	config.SaveProjects("config.json", s.projects)
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

	newProj := config.Project{
		ID:           fmt.Sprintf("%d", time.Now().UnixMilli()),
		Name:         req.Name,
		Path:         cleanPath,
		Command:      req.Command,
		Tag:          req.Tag,
		Interactive:  req.Interactive,
		AutoStart:    req.AutoStart,
		AutoRestart:  req.AutoRestart,
		AutoClose:    req.AutoClose,
		ClearOnStart: req.ClearOnStart,
		Source:       "local",
		Status:       "stopped",
	}

	s.mu.Lock()
	newProj.Order = len(s.projects)
	s.projects = append(s.projects, newProj)
	config.SaveProjects("config.json", s.projects)
	s.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(newProj)
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

	newProj := config.Project{
		ID:           fmt.Sprintf("%d", time.Now().UnixMilli()),
		Name:         repoName,
		Path:         destPath,
		Command:      req.Command,
		Tag:          req.Tag,
		Interactive:  req.Interactive,
		AutoStart:    req.AutoStart,
		AutoRestart:  req.AutoRestart,
		AutoClose:    req.AutoClose,
		ClearOnStart: req.ClearOnStart,
		Source:       "github",
		Status:       "stopped",
	}

	s.mu.Lock()
	newProj.Order = len(s.projects)
	s.projects = append(s.projects, newProj)
	config.SaveProjects("config.json", s.projects)
	s.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(newProj)
}

func (s *Server) handleDeleteProject(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	id := r.URL.Query().Get("id")
	removeFiles := r.URL.Query().Get("remove_files") == "true"

	if id == "" {
		http.Error(w, `{"error": "Missing project ID"}`, http.StatusBadRequest)
		return
	}

	if s.manager.IsRunning(id) {
		_ = s.manager.Stop(id)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	found := false
	var updatedProjects []config.Project
	var projectToDelete *config.Project

	for _, p := range s.projects {
		if p.ID == id {
			found = true
			projCopy := p
			projectToDelete = &projCopy
		} else {
			updatedProjects = append(updatedProjects, p)
		}
	}

	if !found {
		http.Error(w, `{"error": "Project not found"}`, http.StatusNotFound)
		return
	}

	if removeFiles && projectToDelete != nil && projectToDelete.Source == "github" {
		os.RemoveAll(projectToDelete.Path)
	}

	for i := range updatedProjects {
		updatedProjects[i].Order = i
	}

	s.projects = updatedProjects
	config.SaveProjects("config.json", s.projects)

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
		http.Error(w, `{"error": "Invalid request payload"}`, http.StatusBadRequest)
		return
	}

	if len(req.IDs) == 0 {
		http.Error(w, `{"error": "No IDs provided"}`, http.StatusBadRequest)
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	idMap := make(map[string]bool)
	for _, id := range req.IDs {
		idMap[id] = true
		if s.manager.IsRunning(id) {
			_ = s.manager.Stop(id)
		}
	}

	var updatedProjects []config.Project
	deletedCount := 0

	for _, p := range s.projects {
		if idMap[p.ID] {
			if req.RemoveFiles && p.Source == "github" {
				os.RemoveAll(p.Path)
			}
			deletedCount++
		} else {
			updatedProjects = append(updatedProjects, p)
		}
	}

	for i := range updatedProjects {
		updatedProjects[i].Order = i
	}

	s.projects = updatedProjects
	config.SaveProjects("config.json", s.projects)

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

	s.mu.Lock()
	defer s.mu.Unlock()

	projectMap := make(map[string]config.Project)
	for _, p := range s.projects {
		projectMap[p.ID] = p
	}

	var reorderedProjects []config.Project
	for index, id := range newOrderIDs {
		if p, exists := projectMap[id]; exists {
			p.Order = index
			reorderedProjects = append(reorderedProjects, p)
			delete(projectMap, id)
		}
	}

	for _, p := range projectMap {
		p.Order = len(reorderedProjects)
		reorderedProjects = append(reorderedProjects, p)
	}

	s.projects = reorderedProjects
	config.SaveProjects("config.json", s.projects)
	w.WriteHeader(http.StatusOK)
}

func (s *Server) handleStartProject(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	id := r.URL.Query().Get("id")
	s.mu.RLock()
	var target *config.Project
	for _, p := range s.projects {
		if p.ID == id {
			target = &p
			break
		}
	}
	s.mu.RUnlock()

	if target == nil {
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

	if err := s.manager.Stop(r.URL.Query().Get("id")); err != nil {
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
	for _, id := range ids {
		s.mu.RLock()
		var target *config.Project
		for _, p := range s.projects {
			if p.ID == id {
				target = &p
				break
			}
		}
		s.mu.RUnlock()

		if target != nil {
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
	for _, id := range ids {
		if err := s.manager.Stop(id); err == nil {
			stoppedCount++
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": fmt.Sprintf("Successfully stopped %d project(s)", stoppedCount)})
}

func (s *Server) handleProjectEnv(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, `{"error": "Missing project ID"}`, http.StatusBadRequest)
		return
	}

	s.mu.RLock()
	var targetPath string
	for _, p := range s.projects {
		if p.ID == id {
			targetPath = p.Path
			break
		}
	}
	s.mu.RUnlock()

	if targetPath == "" {
		http.Error(w, `{"error": "Project not found"}`, http.StatusNotFound)
		return
	}

	envFile := filepath.Join(targetPath, ".env")

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

	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, `{"error": "Missing project ID"}`, http.StatusBadRequest)
		return
	}

	s.mu.RLock()
	var targetProject *config.Project
	for _, p := range s.projects {
		if p.ID == id {
			pCopy := p
			targetProject = &pCopy
			break
		}
	}
	s.mu.RUnlock()

	if targetProject == nil {
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

	id := r.URL.Query().Get("id")
	if id == "" {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"logs": ""}`))
		return
	}

	var logPath string

	if id == "system" {
		logPath = "dionyhub_system.log"
	} else {
		s.mu.RLock()
		var targetPath string
		for _, p := range s.projects {
			if p.ID == id {
				targetPath = p.Path
				break
			}
		}
		s.mu.RUnlock()

		if targetPath == "" {
			http.Error(w, `{"error": "Project not found"}`, http.StatusNotFound)
			return
		}

		logPath = filepath.Join(targetPath, "dionyhub_log", "output.log")
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
