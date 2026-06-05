// Package logger provides structured and rotating logging mechanisms.
package logger

import (
	"log/slog"
	"os"
)

// InitGlobalLogger sets up the foundational structured logger (slog).
// In the upcoming phases, we will map this to output internal debug logs
// separately from the user-facing system logs.
func InitGlobalLogger() {
	opts := &slog.HandlerOptions{
		Level: slog.LevelDebug, // Geliştirme aşamasında her şeyi görmek için Debug seviyesindeyiz
	}

	// Şimdilik sadece terminale şık bir formatta (TextHandler) yazacak
	// İleride bunu rotating.go ile birleştirip debug.log dosyasına bağlayacağız.
	logger := slog.New(slog.NewTextHandler(os.Stdout, opts))

	// Tüm Go ekosisteminde varsayılan loglayıcı olarak bunu belirliyoruz
	slog.SetDefault(logger)
}
