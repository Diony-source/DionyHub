// Package osutil provides operating system specific utilities such as native dialogs.
package osutil

import (
	"os/exec"
	"runtime"
	"strings"
)

// PickFolder opens the native OS folder selection dialog and returns the selected path.
// It uses PowerShell on Windows, AppleScript on macOS, and Zenity on Linux.
func PickFolder() (string, error) {
	var cmd *exec.Cmd

	if runtime.GOOS == "windows" {
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
	} else if runtime.GOOS == "darwin" {
		// macOS: AppleScript native dialog
		appleScript := `tell application "System Events" to return POSIX path of (choose folder with prompt "Select Project Directory")`
		cmd = exec.Command("osascript", "-e", appleScript)
	} else {
		// Linux: Zenity fallback
		cmd = exec.Command("zenity", "--file-selection", "--directory", "--title=Select Project Directory")
	}

	out, err := cmd.Output()
	if err != nil {
		return "", err
	}

	// Clean up newlines and return the selected path securely
	return strings.TrimSpace(string(out)), nil
}
