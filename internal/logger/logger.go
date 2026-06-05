// Package logger provides structured and rotating logging mechanisms.
package logger

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
)

// InitGlobalLogger initializes a global slog instance that writes to both stdout and a rotating file.
func InitGlobalLogger() {
	logDir := "DionyHub_SystemLogs"
	os.MkdirAll(logDir, 0755)
	engineLogPath := filepath.Join(logDir, "engine_audit.log")

	fileWriter, err := NewRotatingLogWriter(engineLogPath, 10)
	if err != nil {
		panic("Failed to initialize engine logger: " + err.Error())
	}

	multiWriter := io.MultiWriter(os.Stdout, fileWriter)

	// YENİ: Logları okunaklı hale getiren özel biçimlendirici
	opts := &slog.HandlerOptions{
		Level:     slog.LevelDebug,
		AddSource: false, // DİKKAT: Terminali kirletmemesi için dosya yollarını gizledik
		ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
			// Saati kısalt: Sadece Saat:Dakika:Saniye
			if a.Key == slog.TimeKey {
				return slog.String(a.Key, a.Value.Time().Format("15:04:05"))
			}
			return a
		},
	}

	logger := slog.New(slog.NewTextHandler(multiWriter, opts))
	slog.SetDefault(logger)

	slog.Info("Global structured logging engine initialized successfully",
		slog.String("log_dir", logDir),
		slog.Int("max_size_mb", 10),
	)
}
