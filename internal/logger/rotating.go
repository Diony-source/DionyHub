// Package logger provides structured and rotating logging mechanisms
// to ensure system audits and project outputs are safely stored without overflowing disk space.
package logger

import (
	"archive/zip"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// RotatingLogWriter manages log file writes, automatically archiving and zipping
// old logs when they exceed a specified size threshold.
type RotatingLogWriter struct {
	mu       sync.Mutex
	logPath  string
	maxBytes int64
	file     *os.File
	size     int64
}

// NewRotatingLogWriter initializes and opens a new auto-rotating log file.
func NewRotatingLogWriter(logPath string, maxMB int) (*RotatingLogWriter, error) {
	rlw := &RotatingLogWriter{
		logPath:  logPath,
		maxBytes: int64(maxMB) * 1024 * 1024,
	}
	err := rlw.open()
	return rlw, err
}

func (w *RotatingLogWriter) open() error {
	info, err := os.Stat(w.logPath)
	if err == nil {
		w.size = info.Size()
	}
	// Secure file permissions (0644) for standard log files
	f, err := os.OpenFile(w.logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	w.file = f
	return nil
}

// Write safely appends data to the log file. It triggers rotation automatically
// if the new data exceeds the maximum allowed file size.
func (w *RotatingLogWriter) Write(p []byte) (n int, err error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.size+int64(len(p)) > w.maxBytes {
		w.rotate()
	}

	if w.file != nil {
		n, err = w.file.Write(p)
		w.size += int64(n)
		return n, err
	}
	return 0, errors.New("log file is not open")
}

// rotate closes the active file, renames it with a timestamp,
// opens a fresh log file, and asynchronously compresses the old file.
func (w *RotatingLogWriter) rotate() {
	if w.file != nil {
		w.file.Close()
	}

	timestamp := time.Now().Format("2006-01-02_15-04-05")
	archivePath := w.logPath + "." + timestamp + ".log"
	os.Rename(w.logPath, archivePath)

	w.size = 0
	w.open()

	// Zipping operation moved to a goroutine to avoid blocking the main logging thread
	// DİKKAT: Sonsuz döngü yaratmamak için burada slog kullanılmaz! Hatalar stderr'e basılır.
	go func(src string) {
		zipPath := src + ".zip"
		zipFile, err := os.Create(zipPath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "[Logger Fail] Could not create zip archive: %v\n", err)
			return
		}
		defer zipFile.Close()

		archive := zip.NewWriter(zipFile)
		defer archive.Close()

		writer, err := archive.Create(filepath.Base(src))
		if err == nil {
			f, err := os.Open(src)
			if err == nil {
				io.Copy(writer, f)
				f.Close()
				os.Remove(src)
			} else {
				fmt.Fprintf(os.Stderr, "[Logger Fail] Could not open old log for zipping: %v\n", err)
			}
		} else {
			fmt.Fprintf(os.Stderr, "[Logger Fail] Could not create zip entry: %v\n", err)
		}
	}(archivePath)
}

// Close gracefully flushes and closes the underlying file descriptor.
func (w *RotatingLogWriter) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.file != nil {
		return w.file.Close()
	}
	return nil
}
