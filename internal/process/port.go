package process

import (
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
)

// GetProcessByPort checks Windows netstat to find listening PIDs on the specified port.
func GetProcessByPort(port string) (int, string, error) {
	cmd := exec.Command("cmd", "/c", fmt.Sprintf("netstat -ano | findstr LISTEN | findstr :%s", port))
	out, err := cmd.Output()
	if err != nil || len(out) == 0 {
		return 0, "", fmt.Errorf("no process on port %s", port)
	}

	lines := strings.Split(string(out), "\n")
	for _, line := range lines {
		if strings.Contains(line, "LISTENING") && strings.Contains(line, ":"+port) {
			fields := strings.Fields(line)
			if len(fields) >= 5 {
				pidStr := fields[len(fields)-1]
				pid, err := strconv.Atoi(pidStr)
				if err == nil && pid > 0 {
					// PID'yi bulduk, şimdi adını (node.exe vs) bulalım
					nameCmd := exec.Command("cmd", "/c", fmt.Sprintf("tasklist /FI \"PID eq %d\" /FO CSV /NH", pid))
					nameOut, _ := nameCmd.Output()
					nameLines := strings.Split(string(nameOut), "\n")
					if len(nameLines) > 0 && len(strings.TrimSpace(nameLines[0])) > 0 {
						name := strings.ReplaceAll(strings.Split(nameLines[0], ",")[0], "\"", "")
						return pid, name, nil
					}
					return pid, "Unknown Process", nil
				}
			}
		}
	}
	return 0, "", fmt.Errorf("no listening process found")
}

// ExtractPortFromEnv, .env dosyasının içindeki HTTP_PORT, PORT gibi değerleri milisaniyede yakalar.
func ExtractPortFromEnv(envContent string) string {
	re := regexp.MustCompile(`(?m)^(?:HTTP_PORT|SERVER_PORT|PORT|APP_PORT)\s*=\s*(\d+)`)
	matches := re.FindStringSubmatch(envContent)
	if len(matches) > 1 {
		return matches[1]
	}
	return ""
}

// ForceKill, işgalci programı acımadan yok eder.
func ForceKill(pid int) {
	exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(pid)).Run()
}
