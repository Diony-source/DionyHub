package api

import (
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
	return &Broadcaster{
		clients: make(map[*websocket.Conn]bool),
	}
}

// Write, io.Writer arayüzünü (interface) uygular. Böylece cmd.Stdout doğrudan buraya yazabilir.
func (b *Broadcaster) Write(p []byte) (n int, err error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	for client := range b.clients {
		err := client.WriteMessage(websocket.TextMessage, p)
		if err != nil {
			client.Close()
			delete(b.clients, client)
		}
	}
	return len(p), nil
}

// HandleWS, tarayıcıdan gelen HTTP isteğini WebSocket bağlantısına yükseltir (Upgrade).
func (b *Broadcaster) HandleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	b.mu.Lock()
	b.clients[conn] = true
	b.mu.Unlock()
}
