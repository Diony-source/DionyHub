// Package process reaper.go
// Ensures no child processes are left behind as zombies consuming RAM and locking ports.
package process

import (
	"fmt"
	"log/slog"
	"os/exec"
	"runtime"
	"syscall"

	"github.com/shirou/gopsutil/v3/process"
)

// killProcessTree attempts to forcefully terminate a process and all its descendants.
func killProcessTree(pid int) error {
	slog.Debug("Zombie Reaper activated: Scanning for process tree", slog.Int("parent_pid", pid))

	if runtime.GOOS == "windows" {
		// Windows'un kendi içinde ağaçları öldürmek için harika bir /T (Tree) parametresi var.
		killCmd := exec.Command("taskkill", "/T", "/F", "/PID", fmt.Sprint(pid))
		killCmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		err := killCmd.Run()
		if err != nil {
			slog.Warn("Windows native tree kill reported an issue (process might already be dead)", slog.Any("error", err))
		}
		return nil
	}

	// Unix/Linux/macOS için: Ağacı (Tree) kendi ellerimizle kazıp buluyoruz
	p, err := process.NewProcess(int32(pid))
	if err != nil {
		slog.Debug("Parent process already dead or inaccessible", slog.Int("pid", pid))
		return nil
	}

	// Tüm çocuk ve torun süreçleri bul
	descendants := getDescendants(p)

	// Çocukları EN DİPTEN yukarıya doğru (Bottom-Up) öldürüyoruz ki,
	// biz onları öldürürken yenilerini doğuramasınlar.
	for i := len(descendants) - 1; i >= 0; i-- {
		child := descendants[i]
		slog.Debug("Reaping zombie child process", slog.Int("child_pid", int(child.Pid)))
		child.Kill() // Zaten ölmüşse hata verebilir, yoksayıyoruz.
	}

	// Tüm çocuklar temizlendi, şimdi asıl babanın fişini çekebiliriz
	slog.Debug("Terminating root parent process", slog.Int("pid", pid))
	return p.Kill()
}

// getDescendants recursively finds all child processes of a given process.
func getDescendants(p *process.Process) []*process.Process {
	var descendants []*process.Process
	children, err := p.Children()
	if err == nil {
		for _, child := range children {
			descendants = append(descendants, child)
			descendants = append(descendants, getDescendants(child)...)
		}
	}
	return descendants
}
