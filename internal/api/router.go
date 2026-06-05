package api

import "net/http"

// RegisterRoutes wires up the HTTP endpoints to their respective handler functions.
func (s *Server) RegisterRoutes(mux *http.ServeMux) {
	// Project Operations
	mux.HandleFunc("/api/projects", s.handleGetProjects)
	mux.HandleFunc("/api/projects/add", s.handleAddProject)
	mux.HandleFunc("/api/projects/update", s.handleUpdateProject)
	mux.HandleFunc("/api/projects/start", s.handleStartProject)
	mux.HandleFunc("/api/projects/stop", s.handleStopProject)
	mux.HandleFunc("/api/projects/start-bulk", s.handleStartBulk)
	mux.HandleFunc("/api/projects/stop-bulk", s.handleStopBulk)
	mux.HandleFunc("/api/projects/delete", s.handleDeleteProject)
	mux.HandleFunc("/api/projects/delete-bulk", s.handleDeleteBulk)
	mux.HandleFunc("/api/projects/reorder", s.handleReorderProjects)
	mux.HandleFunc("/api/projects/clone", s.handleCloneProject)
	mux.HandleFunc("/api/projects/env", s.handleProjectEnv)
	mux.HandleFunc("/api/projects/logs", s.handleProjectLogs)
	mux.HandleFunc("/api/projects/backup", s.handleBackupProject)
	mux.HandleFunc("/api/projects/input", s.handleProjectInput)

	// System Operations
	mux.HandleFunc("/api/settings", s.handleSettings)
	mux.HandleFunc("/api/system/browse", s.handleBrowseFolder)
	mux.HandleFunc("/api/tags/manage", s.handleManageTag)

	// WebSockets
	mux.HandleFunc("/ws", s.broadcaster.HandleWS)

	// Start background metric collector
	go s.startMetricsPusher()
}
