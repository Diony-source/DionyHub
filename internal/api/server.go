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
	broadcaster *Broadcaster // YENİ: Log yayıncısı
}

// NewServer creates a new API Server instance.
func NewServer(m *process.Manager, p []config.Project, b *Broadcaster) *Server {
	return &Server{
		manager:     m,
		projects:    p,
		broadcaster: b, // YENİ
	}
}

// RegisterRoutes maps URL paths to their respective handler functions.
func (s *Server) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/projects", s.handleGetProjects)
	mux.HandleFunc("/api/projects/add", s.handleAddProject)
	mux.HandleFunc("/api/projects/start", s.handleStartProject)
	mux.HandleFunc("/api/projects/stop", s.handleStopProject)
	mux.HandleFunc("/api/projects/delete", s.handleDeleteProject)
	mux.HandleFunc("/ws", s.broadcaster.HandleWS) // YENİ: Canlı WebSocket rotası
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
		} else {
			liveProjects[i].Status = "stopped"
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(liveProjects)
}

// handleAddProject dynamically adds a new project to the system and saves it to the config.
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

	if newProj.Name == "" || newProj.Path == "" || newProj.Command == "" {
		http.Error(w, `{"error": "Name, Path, and Command are required fields"}`, http.StatusBadRequest)
		return
	}

	newProj.ID = fmt.Sprintf("%d", time.Now().UnixMilli())
	newProj.Status = "stopped"

	s.mu.Lock()
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

// handleDeleteProject gracefully stops (if running) and removes a project from the system.
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

	// 1. Güvenlik: Eğer uygulama arka planda çalışıyorsa önce zorla durdur (Zombi önlemi)
	if s.manager.IsRunning(id) {
		log.Printf("[API] Force stopping running project before deletion (ID: %s)", id)
		_ = s.manager.Stop(id) // Hata fırlatsa bile silme işlemine devam et
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	// 2. Projeyi listeden bul ve çıkar
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

	// 3. Yeni listeyi diske kaydet
	s.projects = updatedProjects
	err := config.SaveProjects("config.json", s.projects)
	if err != nil {
		log.Printf("[API] Error saving config after deletion: %v", err)
		http.Error(w, `{"error": "Failed to save configuration after deletion"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"message": "Project deleted successfully"}`))
}

// handleStartProject starts a specific background process based on its ID.
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

	log.Printf("[API] START request received for project: %s (Interactive: %t)", target.Name, target.Interactive)

	err := s.manager.Start(target.ID, target.Name, target.Path, target.Interactive, parts[0], parts[1:]...)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error": "%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"message": "Project started successfully"}`))
}

// handleStopProject stops a specific background process based on its ID.
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

	log.Printf("[API] STOP request received for project ID: %s", id)
	err := s.manager.Stop(id)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error": "%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"message": "Project stopped successfully"}`))
}
