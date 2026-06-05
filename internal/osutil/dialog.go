// Package osutil provides operating system specific utilities such as native dialogs.
package osutil

import (
	"log/slog"
	"os/exec"
	"runtime"
	"strings"
)

// PickFolder opens the native OS folder selection dialog and returns the selected path.
// It uses PowerShell on Windows, AppleScript on macOS, and Zenity on Linux.
func PickFolder() (string, error) {
	slog.Debug("Invoking native OS folder picker dialog", slog.String("os", runtime.GOOS))
	var cmd *exec.Cmd

	switch runtime.GOOS {
	case "windows":
		// Windows: Call .NET FolderBrowserDialog via PowerShell
		psScript := `
Add-Type -AssemblyName System.windows.forms
$f = New-Object System.Windows.Forms.FolderBrowserDialog
$f.Description = "Select Project Directory"
$f.ShowNewFolderButton = $true
if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $f.SelectedPath
}
`
		cmd = exec.Command("powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", psScript)
	case "darwin":
		// macOS: AppleScript native dialog
		appleScript := `tell application "System Events" to return POSIX path of (choose folder with prompt "Select Project Directory")`
		cmd = exec.Command("osascript", "-e", appleScript)
	default:
		// Linux: Zenity fallback
		cmd = exec.Command("zenity", "--file-selection", "--directory", "--title=Select Project Directory")
	}

	out, err := cmd.Output()
	if err != nil {
		// DİKKAT: Kullanıcı pencereyi iptal edip kapattığında da hata döner.
		// Bu bir sistem çökmesi olmadığı için Error yerine Debug olarak logluyoruz.
		slog.Debug("Folder picker dialog closed with an error or cancelled by user", slog.Any("error", err))
		return "", err
	}

	// Clean up newlines and return the selected path securely
	selectedPath := strings.TrimSpace(string(out))

	if selectedPath == "" {
		slog.Debug("Folder picker dialog returned an empty path (likely cancelled)")
	} else {
		slog.Debug("Folder picker dialog completed successfully", slog.String("selected_path", selectedPath))
	}

	return selectedPath, nil
}
