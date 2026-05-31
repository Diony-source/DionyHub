// Package api provides the RESTful HTTP endpoints for DionyHub.
package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/Diony-source/DionyHub/internal/config"
	"github.com/Diony-source/DionyHub/internal/process"
)

type Server struct {
	manager     *process.Manager
	mu          sync.RWMutex
	projects    []config.Project
	broadcaster *Broadcaster
}

func NewServer(m *process.Manager, p []config.Project, b *Broadcaster) *Server {
	return &Server{
		manager:     m,
		projects:    p,
		broadcaster: b,
	}
}

func (s *Server) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/projects", s.handleGetProjects)
	mux.HandleFunc("/api/projects/add", s.handleAddProject)
	mux.HandleFunc("/api/projects/update", s.handleUpdateProject)
	mux.HandleFunc("/api/projects/start", s.handleStartProject)
	mux.HandleFunc("/api/projects/stop", s.handleStopProject)
	mux.HandleFunc("/api/projects/delete", s.handleDeleteProject)
	mux.HandleFunc("/api/projects/reorder", s.handleReorderProjects)
	mux.HandleFunc("/api/projects/clone", s.handleCloneProject) // YENİ: GitHub Klonlama Rotası
	mux.HandleFunc("/api/settings", s.handleSettings)
	mux.HandleFunc("/ws", s.broadcaster.HandleWS)
}

func (s *Server) handleSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		settings, _ := config.LoadSettings("app_config.json")
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
		newSettings.Workspace = strings.ReplaceAll(newSettings.Workspace, "\\", "/")

		if err := config.SaveSettings("app_config.json", newSettings); err != nil {
			log.Printf("[API] Failed to save settings: %v", err)
			http.Error(w, `{"error": "Failed to save configuration to disk"}`, http.StatusInternalServerError)
			return
		}

		log.Printf("[API] Global settings updated")
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

	if info, err := os.Stat(updatedData.Path); os.IsNotExist(err) {
		if mkErr := os.MkdirAll(updatedData.Path, 0755); mkErr != nil {
			http.Error(w, `{"error": "Failed to create directory automatically"}`, http.StatusInternalServerError)
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

	var newProj config.Project
	if err := json.NewDecoder(r.Body).Decode(&newProj); err != nil {
		http.Error(w, `{"error": "Invalid JSON body"}`, http.StatusBadRequest)
		return
	}

	cleanPath := strings.TrimSpace(newProj.Path)
	cleanPath = strings.ReplaceAll(cleanPath, "\u202A", "")
	cleanPath = strings.ReplaceAll(cleanPath, "\u202C", "")
	cleanPath = strings.ReplaceAll(cleanPath, "\\", "/")
	newProj.Path = cleanPath
	newProj.Tag = strings.TrimSpace(newProj.Tag)

	if newProj.Name == "" || newProj.Path == "" || newProj.Command == "" {
		http.Error(w, `{"error": "Name, Path, and Command are required fields"}`, http.StatusBadRequest)
		return
	}

	if info, err := os.Stat(newProj.Path); os.IsNotExist(err) {
		if mkErr := os.MkdirAll(newProj.Path, 0755); mkErr != nil {
			http.Error(w, `{"error": "Failed to create workspace directory automatically"}`, http.StatusInternalServerError)
			return
		}
	} else if !info.IsDir() {
		http.Error(w, `{"error": "The specified Path exists but is not a valid directory"}`, http.StatusBadRequest)
		return
	}

	newProj.ID = fmt.Sprintf("%d", time.Now().UnixMilli())
	newProj.Status = "stopped"

	s.mu.Lock()
	newProj.Order = len(s.projects)
	s.projects = append(s.projects, newProj)
	err := config.SaveProjects("config.json", s.projects)
	s.mu.Unlock()

	if err != nil {
		http.Error(w, `{"error": "Failed to save project configuration"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(newProj)
}

// YENİ: GITHUB CLONE & RUN MOTORU
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

	// URL'den Depo (Repo) ismini çıkart (Örn: https://github.com/user/repo.git -> repo)
	parts := strings.Split(req.RepoURL, "/")
	repoName := parts[len(parts)-1]
	repoName = strings.TrimSuffix(repoName, ".git")

	// Global Workspace Yolunu Al
	settings, err := config.LoadSettings("app_config.json")
	if err != nil || settings.Workspace == "" {
		http.Error(w, `{"error": "Global Workspace is not configured. Please define it in Settings first."}`, http.StatusBadRequest)
		return
	}

	destPath := settings.Workspace + "/" + repoName
	destPath = strings.ReplaceAll(destPath, "\\", "/")

	// Klasör zaten var mı kontrol et
	if _, err := os.Stat(destPath); !os.IsNotExist(err) {
		http.Error(w, `{"error": "Directory already exists in Workspace. Use local project addition or delete the existing folder."}`, http.StatusBadRequest)
		return
	}

	// İşletim Sistemine Git Clone Komutu Gönder
	log.Printf("[API] Cloning repository %s into %s", req.RepoURL, destPath)
	cmd := exec.Command("git", "clone", req.RepoURL, destPath)

	if err := cmd.Run(); err != nil {
		log.Printf("[API] Git clone failed: %v", err)
		http.Error(w, `{"error": "Failed to clone repository. Make sure Git is installed and the repository is public."}`, http.StatusInternalServerError)
		return
	}

	// Klonlama başarılı, projeyi sisteme kaydet
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

	log.Printf("[API] GitHub project successfully cloned and registered: %s", repoName)
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
	for _, p := range s.projects {
		if p.ID == id {
			found = true
		} else {
			updatedProjects = append(updatedProjects, p)
		}
	}

	if !found {
		http.Error(w, `{"error": "Project not found"}`, http.StatusNotFound)
		return
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

	parts := strings.Fields(target.Command)
	if len(parts) == 0 {
		http.Error(w, `{"error": "Invalid command configuration"}`, http.StatusInternalServerError)
		return
	}

	if err := s.manager.Start(target.ID, target.Name, target.Path, target.Interactive, parts[0], parts[1:]...); err != nil {
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
