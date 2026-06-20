// Package database migration.go
// Handles seamless transition from legacy JSON configurations to the SQLite engine.
package database

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"

	"github.com/Diony-source/DionyHub/internal/config"
)

// MigrateFromJSON reads the legacy config.json and safely imports all projects into the SQLite database.
func (e *Engine) MigrateFromJSON(jsonPath string) error {
	data, err := os.ReadFile(jsonPath)
	if err != nil {
		if os.IsNotExist(err) {
			// JSON dosyası yoksa sorun değil, demek ki zaten göç edilmiş veya sıfır kurulum.
			return nil
		}
		return err
	}

	var projects []config.Project
	if err := json.Unmarshal(data, &projects); err != nil {
		return fmt.Errorf("failed to parse legacy JSON: %w", err)
	}

	if len(projects) == 0 {
		return nil // Dosya var ama içi boş
	}

	slog.Info("Legacy JSON detected. Starting database migration...", slog.Int("project_count", len(projects)))

	// İşlemi Transaction (TX) içine alıyoruz. Ya hepsi geçer, ya hiçbiri. Yarıda kopma olmaz.
	tx, err := e.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, p := range projects {
		// 1. Projeyi tabloya ekle
		_, err := tx.Exec(`
			INSERT OR IGNORE INTO projects 
			(id, name, path, command, interactive, auto_start, auto_restart, auto_close, clear_on_start, source, order_index)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, p.ID, p.Name, p.Path, p.Command, p.Interactive, p.AutoStart, p.AutoRestart, p.AutoClose, p.ClearOnStart, p.Source, p.Order)

		if err != nil {
			slog.Error("Failed to migrate project", slog.String("project", p.Name), slog.Any("error", err))
			continue
		}

		// 2. Eğer projenin bir Tag'i (Etiketi) varsa, bunu ilişkisel olarak bağla
		if p.Tag != "" {
			// Etiketi tags tablosuna ekle (varsa atlar)
			tx.Exec("INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)", p.Tag, "#6366f1")

			// Eklenen (veya zaten var olan) etiketin ID'sini al
			var tagID int
			err = tx.QueryRow("SELECT id FROM tags WHERE name = ?", p.Tag).Scan(&tagID)
			if err == nil {
				// Proje ile Etiketi birbirine bağla (Many-to-Many ilişkisi)
				tx.Exec("INSERT OR IGNORE INTO project_tags (project_id, tag_id) VALUES (?, ?)", p.ID, tagID)
			}
		}
	}

	// Her şey sorunsuzsa veritabanına kaydet (Commit)
	if err := tx.Commit(); err != nil {
		return err
	}

	slog.Info("Migration completed successfully. Backing up legacy JSON.")

	// Güvenlik için eski config.json dosyasının adını değiştiriyoruz ki her açılışta tekrar göç etmeye çalışmasın
	os.Rename(jsonPath, jsonPath+".bak")

	return nil
}
