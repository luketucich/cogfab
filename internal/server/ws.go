package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/coder/websocket"
	"github.com/luketucich/cogfab/internal/wire"
)

const (
	// writeTimeout bounds how long a single message write may take before the
	// client is considered stuck.
	writeTimeout = 5 * time.Second

	// clientReadLimit fits a full-world placement batch while still bounding
	// memory used by an untrusted WebSocket frame.
	clientReadLimit = 256 << 10

	// Protocol 2 introduced compact authoritative tile updates. Protocol 3 adds
	// compact presence updates. Protocol 4 acknowledges predicted world actions.
	tileUpdateProtocol      = 2
	compactPresenceProtocol = 3
	predictedActionProtocol = 4
)

// acceptOptions is shared by every upgrade. Only the game's own pages may open
// sockets: the production site, plus localhost for the Vite dev server (which
// serves the page on another port than the game). Non-browser clients send no
// Origin header and are allowed; the check is about strangers' web pages
// reaching into rooms from a visitor's browser, not about curl. Keep in step
// with the DOMAIN env in docs/deploy.md.
var acceptOptions = &websocket.AcceptOptions{
	OriginPatterns: []string{"cogfab.io", "www.cogfab.io", "localhost:*", "127.0.0.1:*"},
}

// refuse tells a joiner over a short-lived socket that the room is full, so the
// browser gets a readable answer instead of a failed connection, then closes.
func refuse(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, acceptOptions)
	if err != nil {
		return
	}
	b, _ := json.Marshal(wire.RoomFullMessage{Type: "roomFull"})
	ctx, cancel := context.WithTimeout(r.Context(), writeTimeout)
	defer cancel()
	_ = conn.Write(ctx, websocket.MessageText, b)
	conn.Close(websocket.StatusNormalClosure, "room full")
}

// serve upgrades a request to a WebSocket, joins it to the hub, streams state
// to it, and applies the commands it sends, until it disconnects.
func (h *Hub) serve(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, acceptOptions)
	if err != nil {
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(clientReadLimit)

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	client := &Client{
		send:     make(chan []byte, clientBuffer),
		protocol: protocolVersion(r.URL.Query().Get("protocol")),
	}
	h.Register(client)
	defer h.Unregister(client)

	// pong carries ping timestamps from the reader to the writer. The writer
	// is the only goroutine that writes to the socket, so the reader hands
	// echoes across rather than sending them itself.
	pong := make(chan float64, 4)

	// Reader: decode each frame as a client command and hand it to the hub.
	// Frames that are not valid commands are skipped; any read error
	// (including the client closing) tears the connection down.
	go func() {
		for {
			_, data, err := conn.Read(ctx)
			if err != nil {
				cancel()
				return
			}
			var msg struct {
				wire.Command
				T float64 `json:"t"`
			}
			if err := json.Unmarshal(data, &msg); err != nil {
				continue
			}
			if msg.Type == wire.CmdPing {
				// Hand the timestamp to the writer to echo; a ping never
				// reaches the hub. Drop it if the writer is backed up.
				select {
				case pong <- msg.T:
				default:
				}
				continue
			}
			h.Submit(client, msg.Command)
		}
	}()

	// Writer: stream this client's queue to the socket until it closes or the
	// hub drops it, echoing pings back as pongs along the way.
	write := func(b []byte) error {
		wctx, wcancel := context.WithTimeout(ctx, writeTimeout)
		defer wcancel()
		return conn.Write(wctx, websocket.MessageText, b)
	}
	for {
		select {
		case <-ctx.Done():
			return
		case b, ok := <-client.send:
			if !ok {
				return
			}
			if write(b) != nil {
				return
			}
		case t := <-pong:
			b, _ := json.Marshal(wire.Pong(t)) // fixed struct; marshal can't fail
			if write(b) != nil {
				return
			}
		}
	}
}

// protocolVersion parses a client's numeric wire version. Missing, malformed,
// and negative values stay on the legacy protocol instead of guessing.
func protocolVersion(raw string) int {
	version, err := strconv.Atoi(raw)
	if err != nil || version < 0 {
		return 0
	}
	return version
}
