// Package api provides the RESTful HTTP endpoints for DionyHub.
package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/Diony-source/DionyHub/internal/config"
	"github.com/Diony-source/DionyHub/internal/process"
)

// Server holds dependencies required by the HTTP handlers.
type Server struct {
	manager     *process.Manager
	mu          sync.RWMutex
	projects    []config.Project
	broadcaster *Broadcaster
}

// NewServer creates a new API Server instance.
func NewServer(m *process.Manager, p []config.Project, b *Broadcaster) *Server {
	return &Server{
		manager:     m,
		projects:    p,
		broadcaster: b,
	}
}

// RegisterRoutes maps URL paths to their respective handler functions.
func (s *Server) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/projects", s.handleGetProjects)
	mux.HandleFunc("/api/projects/add", s.handleAddProject)
	mux.HandleFunc("/api/projects/update", s.handleUpdateProject) // YENİ: Güncelleme Rotası
	mux.HandleFunc("/api/projects/start", s.handleStartProject)
	mux.HandleFunc("/api/projects/stop", s.handleStopProject)
	mux.HandleFunc("/api/projects/delete", s.handleDeleteProject)
	mux.HandleFunc("/api/projects/reorder", s.handleReorderProjects)
	mux.HandleFunc("/ws", s.broadcaster.HandleWS)
}

// handleGetProjects returns the list of projects combined with their LIVE running status.
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

// handleUpdateProject modifies an existing project's metadata and persists changes to disk.
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

	// Windows hayalet karakter ve dizin temizliği (Add ile aynı logic)
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

	s.mu.Lock()
	defer s.mu.Unlock()

	found := false
	for i, p := range s.projects {
		if p.ID == updatedData.ID {
			// Sadece belirli alanları güncelle, Order ve ID'ye dokunma
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
		log.Printf("[API] Update save error: %v", err)
		http.Error(w, `{"error": "Failed to save configuration"}`, http.StatusInternalServerError)
		return
	}

	log.Printf("[API] Project updated: %s (ID: %s)", updatedData.Name, updatedData.ID)
	w.WriteHeader(http.StatusOK)
}

// handleAddProject dynamically adds a new project to the system...
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

	newProj.ID = fmt.Sprintf("%d", time.Now().UnixMilli())
	newProj.Status = "stopped"

	s.mu.Lock()
	newProj.Order = len(s.projects)
	s.projects = append(s.projects, newProj)
	err := config.SaveProjects("config.json", s.projects)
	s.mu.Unlock()

	if err != nil {
		log.Printf("[API] Error saving new project: %v", err)
		http.Error(w, `{"error": "Failed to save project configuration"}`, http.StatusInternalServerError)
		return
	}

	log.Printf("[API] New project registered: %s (ID: %s)", newProj.Name, newProj.ID)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(newProj)
}

// handleDeleteProject gracefully stops and removes a project...
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
		log.Printf("[API] Force stopping running project before deletion (ID: %s)", id)
		_ = s.manager.Stop(id)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	found := false
	var updatedProjects []config.Project
	for _, p := range s.projects {
		if p.ID == id {
			found = true
			log.Printf("[API] Project deleted: %s", p.Name)
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
	err := config.SaveProjects("config.json", s.projects)
	if err != nil {
		log.Printf("[API] Error saving config after deletion: %v", err)
		http.Error(w, `{"error": "Failed to save configuration after deletion"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
}

// handleReorderProjects accepts a new sequence of project IDs...
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
	err := config.SaveProjects("config.json", s.projects)
	if err != nil {
		log.Printf("[API] Error saving reordered configuration: %v", err)
		http.Error(w, `{"error": "Failed to save reordered configuration"}`, http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

// handleStartProject starts a specific background process...
func (s *Server) handleStartProject(w http.ResponseWriter, r *http.Request) {
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

	err := s.manager.Start(target.ID, target.Name, target.Path, target.Interactive, parts[0], parts[1:]...)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error": "%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

// handleStopProject stops a specific background process...
func (s *Server) handleStopProject(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, `{"error": "Missing project ID"}`, http.StatusBadRequest)
		return
	}

	err := s.manager.Stop(id)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error": "%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}
