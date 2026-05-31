package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/Diony-source/DionyHub/internal/archive" // YENİ EKLENDİ
	"github.com/Diony-source/DionyHub/internal/config"
	"github.com/Diony-source/DionyHub/internal/process"
)

// Server handles all REST API requests and manages process state securely.
type Server struct {
	manager     *process.Manager
	mu          sync.RWMutex
	projects    []config.Project
	broadcaster *Broadcaster
}

// NewServer initializes and returns a new Server instance.
func NewServer(m *process.Manager, p []config.Project, b *Broadcaster) *Server {
	return &Server{
		manager:     m,
		projects:    p,
		broadcaster: b,
	}
}

// RegisterRoutes maps HTTP endpoints to their respective handler functions.
func (s *Server) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/projects", s.handleGetProjects)
	mux.HandleFunc("/api/projects/add", s.handleAddProject)
	mux.HandleFunc("/api/projects/update", s.handleUpdateProject)
	mux.HandleFunc("/api/projects/start", s.handleStartProject)
	mux.HandleFunc("/api/projects/stop", s.handleStopProject)
	mux.HandleFunc("/api/projects/delete", s.handleDeleteProject)
	mux.HandleFunc("/api/projects/reorder", s.handleReorderProjects)
	mux.HandleFunc("/api/projects/clone", s.handleCloneProject)
	mux.HandleFunc("/api/projects/env", s.handleProjectEnv)
	mux.HandleFunc("/api/projects/backup", s.handleBackupProject) // YENİ ROTA
	mux.HandleFunc("/api/settings", s.handleSettings)
	mux.HandleFunc("/ws", s.broadcaster.HandleWS)
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

		newSettings.Workspace = strings.TrimSpace(newSettings.Workspace)
		newSettings.Workspace = strings.ReplaceAll(newSettings.Workspace, "\u202A", "")
		newSettings.Workspace = strings.ReplaceAll(newSettings.Workspace, "\u202C", "")
		newSettings.Workspace = strings.ReplaceAll(newSettings.Workspace, "\\", "/")

		newSettings.GlobalEnv = strings.TrimSpace(newSettings.GlobalEnv)

		if err := config.SaveSettings("app_config.json", newSettings); err != nil {
			log.Printf("[API] Failed to save settings: %v", err)
			http.Error(w, `{"error": "Failed to save configuration to disk"}`, http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"message": "Settings saved successfully"}`))
		return
	}

	http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
}

func (s *Server) handleGetProjects(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	liveProjects := make([]config.Project, len(s.projects))
	for i, p := range s.projects {
		liveProjects[i] = p

		if s.manager.IsRunning(p.ID) {
			liveProjects[i].Status = "running"
			cpu, ram := s.manager.GetStats(p.ID)
			liveProjects[i].CPU = cpu
			liveProjects[i].RAM = ram
		} else {
			liveProjects[i].Status = "stopped"
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(liveProjects)
}

func (s *Server) handleUpdateProject(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var updatedData config.Project
	if err := json.NewDecoder(r.Body).Decode(&updatedData); err != nil {
		http.Error(w, `{"error": "Invalid JSON body"}`, http.StatusBadRequest)
		return
	}

	cleanPath := strings.TrimSpace(updatedData.Path)
	cleanPath = strings.ReplaceAll(cleanPath, "\u202A", "")
	cleanPath = strings.ReplaceAll(cleanPath, "\u202C", "")
	cleanPath = strings.ReplaceAll(cleanPath, "\\", "/")
	updatedData.Path = cleanPath
	updatedData.Tag = strings.TrimSpace(updatedData.Tag)

	if updatedData.ID == "" || updatedData.Name == "" || updatedData.Path == "" {
		http.Error(w, `{"error": "ID, Name, and Path are required"}`, http.StatusBadRequest)
		return
	}

	info, err := os.Stat(updatedData.Path)
	if err != nil {
		if os.IsNotExist(err) {
			if mkErr := os.MkdirAll(updatedData.Path, 0755); mkErr != nil {
				http.Error(w, `{"error": "Failed to create directory automatically"}`, http.StatusInternalServerError)
				return
			}
		} else {
			http.Error(w, `{"error": "Invalid directory path format"}`, http.StatusBadRequest)
			return
		}
	} else if !info.IsDir() {
		http.Error(w, `{"error": "The specified Path exists but is not a valid directory"}`, http.StatusBadRequest)
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	found := false
	for i, p := range s.projects {
		if p.ID == updatedData.ID {
			s.projects[i].Name = updatedData.Name
			s.projects[i].Path = updatedData.Path
			s.projects[i].Command = updatedData.Command
			s.projects[i].Interactive = updatedData.Interactive
			s.projects[i].AutoStart = updatedData.AutoStart
			s.projects[i].Tag = updatedData.Tag
			found = true
			break
		}
	}

	if !found {
		http.Error(w, `{"error": "Project not found"}`, http.StatusNotFound)
		return
	}

	if err := config.SaveProjects("config.json", s.projects); err != nil {
		http.Error(w, `{"error": "Failed to save configuration"}`, http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

func (s *Server) handleAddProject(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Name        string `json:"name"`
		Path        string `json:"path"`
		Command     string `json:"command"`
		Tag         string `json:"tag"`
		Interactive bool   `json:"interactive"`
		AutoStart   bool   `json:"auto_start"`
		InitialEnv  string `json:"initial_env"`
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
		http.Error(w, `{"error": "Name, Path, and Command are required fields"}`, http.StatusBadRequest)
		return
	}

	info, err := os.Stat(cleanPath)
	if err != nil {
		if os.IsNotExist(err) {
			if mkErr := os.MkdirAll(cleanPath, 0755); mkErr != nil {
				http.Error(w, `{"error": "Failed to create workspace directory automatically"}`, http.StatusInternalServerError)
				return
			}
		} else {
			http.Error(w, `{"error": "Invalid directory path format"}`, http.StatusBadRequest)
			return
		}
	} else if !info.IsDir() {
		http.Error(w, `{"error": "The specified Path exists but is not a valid directory"}`, http.StatusBadRequest)
		return
	}

	if req.InitialEnv != "" {
		envPath := filepath.Join(cleanPath, ".env")
		if err := os.WriteFile(envPath, []byte(req.InitialEnv), 0644); err != nil {
			log.Printf("[API] WARNING: Failed to create initial .env file at %s: %v", envPath, err)
		} else {
			log.Printf("[API] Initial .env file securely created at %s", envPath)
		}
	}

	newProj := config.Project{
		ID:          fmt.Sprintf("%d", time.Now().UnixMilli()),
		Name:        req.Name,
		Path:        cleanPath,
		Command:     req.Command,
		Tag:         req.Tag,
		Interactive: req.Interactive,
		AutoStart:   req.AutoStart,
		Status:      "stopped",
	}

	s.mu.Lock()
	newProj.Order = len(s.projects)
	s.projects = append(s.projects, newProj)
	saveErr := config.SaveProjects("config.json", s.projects)
	s.mu.Unlock()

	if saveErr != nil {
		http.Error(w, `{"error": "Failed to save project configuration"}`, http.StatusInternalServerError)
		return
	}

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
		RepoURL     string `json:"repo_url"`
		Command     string `json:"command"`
		Tag         string `json:"tag"`
		Interactive bool   `json:"interactive"`
		AutoStart   bool   `json:"auto_start"`
		InitialEnv  string `json:"initial_env"`
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

	parts := strings.Split(req.RepoURL, "/")
	repoName := parts[len(parts)-1]
	repoName = strings.TrimSuffix(repoName, ".git")

	settings, err := config.LoadSettings("app_config.json")
	if err != nil || settings.Workspace == "" {
		http.Error(w, `{"error": "Global Workspace is not configured. Please define it in Settings first."}`, http.StatusBadRequest)
		return
	}

	cleanWorkspace := strings.ReplaceAll(settings.Workspace, "\u202A", "")
	cleanWorkspace = strings.ReplaceAll(cleanWorkspace, "\u202C", "")

	if err := os.MkdirAll(cleanWorkspace, 0755); err != nil {
		http.Error(w, `{"error": "Failed to create Global Workspace parent directory"}`, http.StatusInternalServerError)
		return
	}

	destPath := cleanWorkspace + "/" + repoName
	destPath = strings.ReplaceAll(destPath, "\\", "/")

	if _, err := os.Stat(destPath); err == nil {
		http.Error(w, `{"error": "Directory already exists in Workspace. Delete the existing folder first."}`, http.StatusBadRequest)
		return
	}

	cmd := exec.Command("git", "clone", req.RepoURL, destPath)
	output, err := cmd.CombinedOutput()

	if err != nil {
		errMsg := strings.TrimSpace(string(output))
		errMsg = strings.ReplaceAll(errMsg, "\n", " | ")
		errMsg = strings.ReplaceAll(errMsg, "\"", "'")
		http.Error(w, fmt.Sprintf(`{"error": "Git Clone Failed: %s"}`, errMsg), http.StatusInternalServerError)
		return
	}

	if req.InitialEnv != "" {
		envPath := filepath.Join(destPath, ".env")
		if err := os.WriteFile(envPath, []byte(req.InitialEnv), 0644); err != nil {
			log.Printf("[API] WARNING: Failed to create initial .env file at %s: %v", envPath, err)
		} else {
			log.Printf("[API] Initial .env file securely created at %s", envPath)
		}
	}

	newProj := config.Project{
		ID:          fmt.Sprintf("%d", time.Now().UnixMilli()),
		Name:        repoName,
		Path:        destPath,
		Command:     req.Command,
		Tag:         req.Tag,
		Interactive: req.Interactive,
		AutoStart:   req.AutoStart,
		Status:      "stopped",
	}

	s.mu.Lock()
	newProj.Order = len(s.projects)
	s.projects = append(s.projects, newProj)
	saveErr := config.SaveProjects("config.json", s.projects)
	s.mu.Unlock()

	if saveErr != nil {
		http.Error(w, `{"error": "Repository cloned but failed to save configuration"}`, http.StatusInternalServerError)
		return
	}

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

	if removeFiles && projectToDelete != nil {
		if err := os.RemoveAll(projectToDelete.Path); err != nil {
			log.Printf("[API] Warning: Failed to forcefully remove directory %s: %v", projectToDelete.Path, err)
		}
	}

	for i := range updatedProjects {
		updatedProjects[i].Order = i
	}

	s.projects = updatedProjects
	if err := config.SaveProjects("config.json", s.projects); err != nil {
		http.Error(w, `{"error": "Failed to save configuration after deletion"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
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
	if err := config.SaveProjects("config.json", s.projects); err != nil {
		http.Error(w, `{"error": "Failed to save reordered projects"}`, http.StatusInternalServerError)
		return
	}
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

	parts := strings.Fields(target.Command)
	if len(parts) == 0 {
		http.Error(w, `{"error": "Invalid command configuration"}`, http.StatusInternalServerError)
		return
	}

	settings, err := config.LoadSettings("app_config.json")
	if err != nil {
		log.Printf("[API] Warning: Failed to load global settings before start: %v", err)
	}

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

	if err := s.manager.Start(target.ID, target.Name, target.Path, target.Interactive, globalEnvs, parts[0], parts[1:]...); err != nil {
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
		if err := json.NewEncoder(w).Encode(response); err != nil {
			http.Error(w, `{"error": "Failed to encode response"}`, http.StatusInternalServerError)
		}
		return
	}

	if r.Method == http.MethodPost {
		var req struct {
			Content string `json:"content"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, `{"error": "Invalid request body"}`, http.StatusBadRequest)
			return
		}

		if err := os.WriteFile(envFile, []byte(req.Content), 0644); err != nil {
			http.Error(w, `{"error": "Failed to write .env file"}`, http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
		return
	}

	http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
}

// YENİ: Yedekleme (Backup) işlemi rotası
// handleBackupProject safely archives the target project directory into a designated backups folder.
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
		http.Error(w, `{"error": "Workspace is not defined. Cannot determine backup location."}`, http.StatusInternalServerError)
		return
	}

	// Create backup directory securely inside Global Workspace
	backupDir := filepath.Join(settings.Workspace, "DionyHub_Backups")
	if err := os.MkdirAll(backupDir, 0755); err != nil {
		http.Error(w, `{"error": "Failed to create backup directory"}`, http.StatusInternalServerError)
		return
	}

	// Generate a secure, timestamped filename
	timestamp := time.Now().Format("20060102_150405")
	safeName := strings.ReplaceAll(targetProject.Name, " ", "_")
	zipFileName := fmt.Sprintf("%s_backup_%s.zip", safeName, timestamp)
	targetZipPath := filepath.Join(backupDir, zipFileName)

	// Execute archiving logic
	if err := archive.ZipDirectory(targetProject.Path, targetZipPath); err != nil {
		log.Printf("[API] Backup failed for %s: %v", targetProject.Name, err)
		http.Error(w, `{"error": "Failed to create zip archive"}`, http.StatusInternalServerError)
		return
	}

	log.Printf("[API] Project %s successfully backed up to %s", targetProject.Name, targetZipPath)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"message": fmt.Sprintf("Backup saved to Backups folder as %s", zipFileName),
	})
}
