// Package api provides the RESTful HTTP endpoints for DionyHub.
package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/Diony-source/DionyHub/internal/config"
	"github.com/Diony-source/DionyHub/internal/process"
)

// Server holds dependencies required by the HTTP handlers.
type Server struct {
	manager  *process.Manager
	projects []config.Project
}

// NewServer creates a new API Server instance.
func NewServer(m *process.Manager, p []config.Project) *Server {
	return &Server{
		manager:  m,
		projects: p,
	}
}

// RegisterRoutes maps URL paths to their respective handler functions.
func (s *Server) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/projects", s.handleGetProjects)
	mux.HandleFunc("/api/projects/start", s.handleStartProject)
	mux.HandleFunc("/api/projects/stop", s.handleStopProject)
}

// handleGetProjects returns the list of projects.
func (s *Server) handleGetProjects(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(s.projects)
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

	// Find project configuration
	var target *config.Project
	for _, p := range s.projects {
		if p.ID == id {
			target = &p
			break
		}
	}

	if target == nil {
		http.Error(w, `{"error": "Project not found"}`, http.StatusNotFound)
		return
	}

	// Simple command parser (e.g., "go run main.go" -> "go", ["run", "main.go"])
	parts := strings.Fields(target.Command)
	if len(parts) == 0 {
		http.Error(w, `{"error": "Invalid command configuration"}`, http.StatusInternalServerError)
		return
	}

	err := s.manager.Start(target.ID, target.Name, target.Path, parts[0], parts[1:]...)
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

	err := s.manager.Stop(id)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error": "%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"message": "Project stopped successfully"}`))
}
