package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // Arayüzümüz lokal çalıştığı için tüm bağlantılara izin veriyoruz
	},
}

// Broadcaster, uygulamalardan gelen yazıları yakalar ve tüm WebSocket istemcilerine dağıtır.
type Broadcaster struct {
	clients map[*websocket.Conn]bool
	mu      sync.Mutex
}

func NewBroadcaster() *Broadcaster {
	slog.Debug("Initializing WebSocket Broadcaster component")
	return &Broadcaster{
		clients: make(map[*websocket.Conn]bool),
	}
}

// Write, io.Writer arayüzünü (interface) uygular.
// Terminal komutları (stdout) ham text olarak gelir. Biz bunu JSON formatına ("action": "log") sarmalarız.
func (b *Broadcaster) Write(p []byte) (n int, err error) {
	// Eğer veri zaten "id" veya "action" içeren formatlanmış bir JSON ise (örn: Metrics) ona dokunmadan gönder
	var rawJSON map[string]interface{}
	if err := json.Unmarshal(p, &rawJSON); err == nil && (rawJSON["action"] != nil || rawJSON["id"] != nil) {
		b.broadcast(p)
		return len(p), nil
	}

	// Değilse, bu bir terminal logudur. System sekmesine yönlendir.
	payload := map[string]string{
		"id":     "system",
		"action": "log",
		"data":   string(p),
	}

	msg, err := json.Marshal(payload)
	if err != nil {
		return len(p), nil
	}

	b.broadcast(msg)
	return len(p), nil
}

// broadcast, hazır mesaj paketini (byte dizisini) tüm bağlı istemcilere fırlatır.
func (b *Broadcaster) broadcast(msg []byte) {
	b.mu.Lock()
	defer b.mu.Unlock()

	for client := range b.clients {
		err := client.WriteMessage(websocket.TextMessage, msg)
		if err != nil {
			slog.Warn("WebSocket client disconnected or write failed, cleaning up",
				slog.String("client_ip", client.RemoteAddr().String()),
				slog.Any("error", err),
			)
			client.Close()
			delete(b.clients, client)
		}
	}
}

// HandleWS, tarayıcıdan gelen HTTP isteğini WebSocket bağlantısına yükseltir (Upgrade).
func (b *Broadcaster) HandleWS(w http.ResponseWriter, r *http.Request) {
	slog.Debug("Incoming WebSocket upgrade request", slog.String("client_ip", r.RemoteAddr))

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("Failed to upgrade HTTP connection to WebSocket",
			slog.String("client_ip", r.RemoteAddr),
			slog.Any("error", err),
		)
		return
	}

	b.mu.Lock()
	b.clients[conn] = true
	clientCount := len(b.clients)
	b.mu.Unlock()

	slog.Info("New WebSocket client connected successfully",
		slog.String("client_ip", conn.RemoteAddr().String()),
		slog.Int("total_active_clients", clientCount),
	)
}
