// Package detector provides smart heuristic scanning for DionyHub.
// It analyzes directory structures to automatically determine project types,
// entry points, and required startup commands dynamically.
package detector

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
)

// Result represents the findings of the smart heuristic engine.
type Result struct {
	Detected     bool   `json:"detected"`
	Language     string `json:"language"`
	Command      string `json:"command"`
	HasEnv       bool   `json:"has_env"`
	Confidence   int    `json:"confidence"` // 0-100 scale
	ErrorMessage string `json:"error_message,omitempty"`
}

// AnalyzePath scans the target directory and applies deep heuristics to guess the project configuration.
func AnalyzePath(targetPath string) Result {
	slog.Debug("Smart Detective initiated deep scan (VLC Mode)", slog.String("target_path", targetPath))
	res := Result{Detected: false, Confidence: 0}

	// 1. Klasör geçerliliğini kontrol et
	info, err := os.Stat(targetPath)
	if err != nil || !info.IsDir() {
		slog.Warn("Detective failed: Invalid directory path", slog.String("path", targetPath))
		res.ErrorMessage = "Geçersiz klasör yolu veya klasör bulunamadı."
		return res
	}

	// 2. Environment (.env) dosyası var mı?
	if _, err := os.Stat(filepath.Join(targetPath, ".env")); err == nil {
		res.HasEnv = true
	}

	// === 0. DOCKER & MAKEFILE (Evrensel Başlatıcılar) ===
	if _, err := os.Stat(filepath.Join(targetPath, "docker-compose.yml")); err == nil {
		res.Detected = true
		res.Language = "Docker"
		res.Command = "docker-compose up -d"
		res.Confidence = 100
		return res
	}
	if _, err := os.Stat(filepath.Join(targetPath, "Makefile")); err == nil {
		res.Detected = true
		res.Language = "Makefile"
		res.Command = "make"
		res.Confidence = 80
	}

	// === 1. GOLANG (Dinamik Entrypoint ve Bağımsız Script Taraması) ===
	_, errGoMod := os.Stat(filepath.Join(targetPath, "go.mod"))
	_, errMainGo := os.Stat(filepath.Join(targetPath, "main.go"))

	// go.mod YOKSA BİLE main.go varsa Go projesi olduğunu anlar
	if errGoMod == nil || errMainGo == nil {
		res.Detected = true
		res.Language = "Go"
		res.Confidence = 80

		cmdPath := filepath.Join(targetPath, "cmd")
		foundMain := ""
		if info, err := os.Stat(cmdPath); err == nil && info.IsDir() {
			filepath.WalkDir(cmdPath, func(path string, d os.DirEntry, err error) error {
				if err != nil {
					return nil
				}
				if !d.IsDir() && d.Name() == "main.go" {
					rel, _ := filepath.Rel(targetPath, path)
					foundMain = filepath.ToSlash(rel)
					return filepath.SkipDir
				}
				return nil
			})
		}

		if foundMain != "" {
			res.Command = "go run " + foundMain
			res.Confidence = 100
		} else if errMainGo == nil { // Ana dizinde main.go bulundu
			res.Command = "go run main.go"
			res.Confidence = 100
		} else {
			res.Command = "go run ."
		}
		return res
	}

	// === 2. NODE.JS (NPM, Yarn, Bun, Deno ve Bağımsız JS) ===
	if _, err := os.Stat(filepath.Join(targetPath, "deno.json")); err == nil {
		res.Detected = true
		res.Language = "Deno"
		res.Command = "deno run -A main.ts"
		res.Confidence = 90
		return res
	}
	if _, err := os.Stat(filepath.Join(targetPath, "bunfig.toml")); err == nil {
		res.Detected = true
		res.Language = "Bun"
		res.Command = "bun run index.ts"
		res.Confidence = 90
		return res
	}
	if pkgJSON, err := os.ReadFile(filepath.Join(targetPath, "package.json")); err == nil {
		res.Detected = true
		res.Language = "Node.js"
		res.Confidence = 80
		res.Command = "npm start" // Varsayılan

		if _, err := os.Stat(filepath.Join(targetPath, "yarn.lock")); err == nil {
			res.Command = "yarn start"
		} else if _, err := os.Stat(filepath.Join(targetPath, "pnpm-lock.yaml")); err == nil {
			res.Command = "pnpm start"
		}

		var pkg map[string]interface{}
		if err := json.Unmarshal(pkgJSON, &pkg); err == nil {
			if scripts, ok := pkg["scripts"].(map[string]interface{}); ok {
				prefix := "npm run "
				if strings.HasPrefix(res.Command, "yarn") {
					prefix = "yarn "
				}
				if strings.HasPrefix(res.Command, "pnpm") {
					prefix = "pnpm "
				}

				if _, hasDev := scripts["dev"]; hasDev {
					res.Command = prefix + "dev"
					res.Confidence = 100
				} else if _, hasStart := scripts["start"]; hasStart {
					if prefix == "npm run " {
						res.Command = "npm start"
					} else {
						res.Command = prefix + "start"
					}
					res.Confidence = 100
				}
			}
		}
		return res
	}

	// Package.json yok ama bağımsız Node dosyası var
	if _, err := os.Stat(filepath.Join(targetPath, "index.js")); err == nil {
		res.Detected = true
		res.Language = "Node.js"
		res.Command = "node index.js"
		res.Confidence = 70
		return res
	}
	if _, err := os.Stat(filepath.Join(targetPath, "app.js")); err == nil {
		res.Detected = true
		res.Language = "Node.js"
		res.Command = "node app.js"
		res.Confidence = 70
		return res
	}

	// === 3. PYTHON (Django, Flask, Standart, Pipenv ve Bağımsız PY) ===
	if _, err := os.Stat(filepath.Join(targetPath, "manage.py")); err == nil {
		res.Detected = true
		res.Language = "Python (Django)"
		res.Command = "python manage.py runserver"
		res.Confidence = 100
		return res
	}
	if _, err := os.Stat(filepath.Join(targetPath, "requirements.txt")); err == nil {
		res.Detected = true
		res.Language = "Python"
		res.Command = "python app.py"
		res.Confidence = 70
		if _, err := os.Stat(filepath.Join(targetPath, "main.py")); err == nil {
			res.Command = "python main.py"
			res.Confidence = 90
		}
		return res
	}

	// requirements.txt yok ama bağımsız Python scripti var
	if _, err := os.Stat(filepath.Join(targetPath, "main.py")); err == nil {
		res.Detected = true
		res.Language = "Python"
		res.Command = "python main.py"
		res.Confidence = 80
		return res
	}
	if _, err := os.Stat(filepath.Join(targetPath, "app.py")); err == nil {
		res.Detected = true
		res.Language = "Python"
		res.Command = "python app.py"
		res.Confidence = 80
		return res
	}

	// === 4. RUST ===
	if _, err := os.Stat(filepath.Join(targetPath, "Cargo.toml")); err == nil {
		res.Detected = true
		res.Language = "Rust"
		res.Command = "cargo run"
		res.Confidence = 100
		return res
	}

	// === 5. PHP (Laravel, Symfony) ===
	if _, err := os.Stat(filepath.Join(targetPath, "artisan")); err == nil {
		res.Detected = true
		res.Language = "PHP (Laravel)"
		res.Command = "php artisan serve"
		res.Confidence = 100
		return res
	}
	if _, err := os.Stat(filepath.Join(targetPath, "composer.json")); err == nil {
		res.Detected = true
		res.Language = "PHP"
		res.Command = "php -S localhost:8000"
		res.Confidence = 80
		return res
	}

	// === 6. C# / .NET ===
	files, _ := filepath.Glob(filepath.Join(targetPath, "*.csproj"))
	if len(files) > 0 {
		res.Detected = true
		res.Language = ".NET (C#)"
		res.Command = "dotnet run"
		res.Confidence = 100
		return res
	}

	// === 7. JAVA (Maven/Gradle) ===
	if _, err := os.Stat(filepath.Join(targetPath, "pom.xml")); err == nil {
		res.Detected = true
		res.Language = "Java (Maven)"
		res.Command = "mvn spring-boot:run"
		res.Confidence = 80
		return res
	}
	if _, err := os.Stat(filepath.Join(targetPath, "build.gradle")); err == nil {
		res.Detected = true
		res.Language = "Java (Gradle)"
		res.Command = "./gradlew bootRun"
		res.Confidence = 80
		return res
	}

	// === 8. RUBY (Rails, Sinatra) ===
	if _, err := os.Stat(filepath.Join(targetPath, "Gemfile")); err == nil {
		res.Detected = true
		res.Language = "Ruby"
		res.Confidence = 80
		if _, err := os.Stat(filepath.Join(targetPath, "bin", "rails")); err == nil {
			res.Language = "Ruby on Rails"
			res.Command = "bin/rails server"
			res.Confidence = 100
		} else {
			res.Command = "ruby app.rb" // Genel varsayım
		}
		return res
	}

	// === 9. ELIXIR ===
	if _, err := os.Stat(filepath.Join(targetPath, "mix.exs")); err == nil {
		res.Detected = true
		res.Language = "Elixir"
		res.Command = "mix run --no-halt"
		res.Confidence = 100
		return res
	}

	// === 10. DART / FLUTTER ===
	if _, err := os.Stat(filepath.Join(targetPath, "pubspec.yaml")); err == nil {
		res.Detected = true
		res.Language = "Dart"
		res.Command = "dart run"
		res.Confidence = 90
		return res
	}

	// === 11. SWIFT ===
	if _, err := os.Stat(filepath.Join(targetPath, "Package.swift")); err == nil {
		res.Detected = true
		res.Language = "Swift"
		res.Command = "swift run"
		res.Confidence = 90
		return res
	}

	// === 12. EVRENSEL SCRİPTLER (Bash / Batch) ===
	if _, err := os.Stat(filepath.Join(targetPath, "start.sh")); err == nil {
		res.Detected = true
		res.Language = "Shell Script"
		res.Command = "bash start.sh"
		res.Confidence = 80
		return res
	}
	if _, err := os.Stat(filepath.Join(targetPath, "run.bat")); err == nil {
		res.Detected = true
		res.Language = "Batch Script"
		res.Command = "run.bat"
		res.Confidence = 80
		return res
	}

	if res.Detected && res.Language == "Makefile" {
		return res
	}

	slog.Info("Detective could not definitively identify project type", slog.String("path", targetPath))
	res.Detected = false
	res.ErrorMessage = "Proje dili otomatik algılanamadı, lütfen komutu manuel girin."
	return res
}
