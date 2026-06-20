// Package database provides the SQLite engine and data access layers for DionyHub.
package database

import (
	"database/sql"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

	// Pure Go SQLite driver (CGO gerektirmez, her işletim sisteminde çalışır)
	"github.com/Diony-source/DionyHub/internal/config"
	_ "modernc.org/sqlite"
)

// Engine represents the core SQLite database connection and provides access to it.
type Engine struct {
	DB *sql.DB
}

// NewEngine initializes the SQLite database, creates the file if it doesn't exist,
// and applies the foundational schemas.
func NewEngine(dbPath string) (*Engine, error) {
	slog.Debug("Initializing SQLite Engine", slog.String("path", dbPath))

	// 1. Klasör yoksa oluştur (Örn: data/dionyhub.db kullanacaksak data klasörünü yaratır)
	if dir := filepath.Dir(dbPath); dir != "." && dir != "" {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return nil, fmt.Errorf("failed to create db directory: %w", err)
		}
	}

	// 2. Sürücüyü kullanarak veritabanı dosyasını aç (Yoksa otomatik yaratır)
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// 3. Bağlantıyı fiziksel olarak test et
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	// --- ENTERPRISE AYARLAR ---
	// WAL Mode: Sistemin kilitlenmesini engeller, 100 kişi aynı anda veri yazabilir.
	// Foreign Keys: İlişkisel verileri korur (Proje silinince ona bağlı etiketler de silinir).
	pragmas := []string{
		"PRAGMA journal_mode=WAL;",
		"PRAGMA synchronous=NORMAL;",
		"PRAGMA foreign_keys=ON;",
	}
	for _, pragma := range pragmas {
		if _, err := db.Exec(pragma); err != nil {
			slog.Error("Failed to execute PRAGMA", slog.String("pragma", pragma), slog.Any("error", err))
		}
	}

	engine := &Engine{DB: db}

	// 4. Tabloları oluştur (Migration)
	if err := engine.runMigrations(); err != nil {
		return nil, err
	}

	slog.Info("SQLite Engine successfully started and migrated", slog.String("path", dbPath))
	return engine, nil
}

// runMigrations creates the initial database schema if it doesn't exist.
func (e *Engine) runMigrations() error {
	slog.Debug("Running database migrations...")

	// IF NOT EXISTS kullandığımız için bu kod her çalıştığında sıfırlanmaz,
	// sadece tablolar yoksa ilk seferinde yaratır.
	query := `
	-- Sistem Ayarları Tablosu (LogBuffer, GlobalEnv vb. için)
	CREATE TABLE IF NOT EXISTS settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL
	);

	-- Projeler Tablosu (Ana merkezimiz)
	CREATE TABLE IF NOT EXISTS projects (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		path TEXT NOT NULL,
		command TEXT NOT NULL,
		interactive BOOLEAN DEFAULT 0,
		auto_start BOOLEAN DEFAULT 0,
		auto_restart BOOLEAN DEFAULT 0,
		auto_close BOOLEAN DEFAULT 0,
		clear_on_start BOOLEAN DEFAULT 0,
		source TEXT DEFAULT 'local',
		order_index INTEGER DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	-- Küresel Etiketler (Tags) Tablosu
	CREATE TABLE IF NOT EXISTS tags (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT UNIQUE NOT NULL,
		color TEXT NOT NULL
	);

	-- Proje - Etiket İlişki Tablosu (Many-to-Many)
	-- ON DELETE CASCADE: Bir proje silinirse, bu tablodaki o projeye ait satırlar otomatik silinir!
	CREATE TABLE IF NOT EXISTS project_tags (
		project_id TEXT,
		tag_id INTEGER,
		PRIMARY KEY (project_id, tag_id),
		FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
		FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
	);
	`

	_, err := e.DB.Exec(query)
	if err != nil {
		slog.Error("Failed to run database migrations", slog.Any("error", err))
		return fmt.Errorf("migration failed: %w", err)
	}

	return nil
}

// Close gracefully shuts down the database connection.
func (e *Engine) Close() error {
	slog.Debug("Closing SQLite Engine")
	return e.DB.Close()
}

// GetProjects tüm projeleri veritabanından çekip listeleyen fonksiyondur.
func (e *Engine) GetProjects() ([]config.Project, error) {
	query := `SELECT id, name, path, command, interactive, auto_start, auto_restart, auto_close, clear_on_start, source, order_index FROM projects ORDER BY order_index ASC`

	rows, err := e.DB.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var projects []config.Project
	for rows.Next() {
		var p config.Project
		err := rows.Scan(
			&p.ID, &p.Name, &p.Path, &p.Command,
			&p.Interactive, &p.AutoStart, &p.AutoRestart, &p.AutoClose,
			&p.ClearOnStart, &p.Source, &p.Order,
		)
		if err != nil {
			return nil, err
		}
		// Etiket (tag) ilişkisini sonradan temiz sorgularla bağlayacağız, şimdilik temel yapı tamam.
		projects = append(projects, p)
	}
	return projects, nil
}

// GetProjectByID fetches a single project from the database using its unique ID.
// It is heavily used by action handlers (Start, Stop, Restart) to resolve project details.
func (e *Engine) GetProjectByID(id string) (config.Project, error) {
	query := `SELECT id, name, path, command, interactive, auto_start, auto_restart, auto_close, clear_on_start, source, order_index FROM projects WHERE id = ?`

	var p config.Project
	err := e.DB.QueryRow(query, id).Scan(
		&p.ID, &p.Name, &p.Path, &p.Command,
		&p.Interactive, &p.AutoStart, &p.AutoRestart, &p.AutoClose,
		&p.ClearOnStart, &p.Source, &p.Order,
	)
	if err != nil {
		return p, fmt.Errorf("project not found or db error: %w", err)
	}
	return p, nil
}
