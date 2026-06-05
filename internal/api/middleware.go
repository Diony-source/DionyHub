package api

import (
	"bufio"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"
)

// responseRecorder helps us capture the HTTP status code before it's sent to the client.
type responseRecorder struct {
	http.ResponseWriter
	statusCode int
}

func (rec *responseRecorder) WriteHeader(code int) {
	rec.statusCode = code
	rec.ResponseWriter.WriteHeader(code)
}

// YENİ: Hijack yeteneği eklendi! WebSocket bağlantılarının kopmasını engeller.
func (rec *responseRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := rec.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("webserver doesn't support hijacking")
	}
	return hijacker.Hijack()
}

// LoggingMiddleware captures and logs relevant HTTP requests made to the system.
func LoggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		rec := &responseRecorder{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(rec, r)

		duration := time.Since(start)
		path := r.URL.Path

		// YENİ: Spam Filtresi! CSS, JS, Favicon ve WebSocket trafiğini loglama.
		if path == "/ws" || path == "/favicon.ico" || strings.HasPrefix(path, "/css/") || strings.HasPrefix(path, "/js/") {
			return
		}

		if rec.statusCode >= 500 {
			slog.Error("API Request Failed (Server Error)",
				slog.String("method", r.Method),
				slog.String("path", path),
				slog.Int("status", rec.statusCode),
				slog.Duration("duration", duration),
			)
		} else if rec.statusCode >= 400 {
			slog.Warn("API Request Failed (Client Error)",
				slog.String("method", r.Method),
				slog.String("path", path),
				slog.Int("status", rec.statusCode),
				slog.Duration("duration", duration),
			)
		} else {
			slog.Info("API Request Executed",
				slog.String("method", r.Method),
				slog.String("path", path),
				slog.Int("status", rec.statusCode),
				slog.Duration("duration", duration),
			)
		}
	})
}
