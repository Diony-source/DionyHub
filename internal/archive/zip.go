// Package archive provides utilities for securely compressing and extracting files.
package archive

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// ZipDirectory creates a .zip archive at targetZip containing the contents of sourceDir.
// It securely traverses the directory tree and explicitly skips ".git" directories
// to prevent bloat and potential corruption of version control data.
func ZipDirectory(sourceDir, targetZip string) error {
	// Create the target zip file securely
	zipFile, err := os.Create(targetZip)
	if err != nil {
		return fmt.Errorf("failed to create target zip file %s: %w", targetZip, err)
	}
	defer zipFile.Close()

	archive := zip.NewWriter(zipFile)
	defer archive.Close()

	// Walk through the source directory explicitly handling errors
	return filepath.Walk(sourceDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return fmt.Errorf("error accessing path %s: %w", path, err)
		}

		// Security & Performance: Skip .git directory to avoid archiving repository history
		if info.IsDir() && info.Name() == ".git" {
			return filepath.SkipDir
		}

		// Calculate relative path to maintain directory structure inside the zip
		relPath, err := filepath.Rel(sourceDir, path)
		if err != nil {
			return fmt.Errorf("failed to calculate relative path for %s: %w", path, err)
		}

		// Ensure forward slashes are used for internal zip paths (ZIP specification requirement)
		relPath = strings.ReplaceAll(relPath, "\\", "/")
		if relPath == "." {
			return nil // Skip the root directory itself
		}

		// Create file header based on OS file info
		header, err := zip.FileInfoHeader(info)
		if err != nil {
			return fmt.Errorf("failed to create zip file header for %s: %w", info.Name(), err)
		}
		header.Name = relPath

		if info.IsDir() {
			header.Name += "/"
		} else {
			header.Method = zip.Deflate // Apply compression only to files
		}

		writer, err := archive.CreateHeader(header)
		if err != nil {
			return fmt.Errorf("failed to write header for %s: %w", header.Name, err)
		}

		// If it's a directory, no content needs to be written
		if info.IsDir() {
			return nil
		}

		// Open target file securely
		file, err := os.Open(path)
		if err != nil {
			return fmt.Errorf("failed to open file %s for archiving: %w", path, err)
		}
		defer file.Close()

		// Copy file content to the zip archive
		if _, err := io.Copy(writer, file); err != nil {
			return fmt.Errorf("failed to write file %s to archive: %w", path, err)
		}

		return nil
	})
}
