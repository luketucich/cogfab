package server

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"github.com/luketucich/cogfab/internal/wire"
)

// writeTimeout bounds how long a single message write may take before the
// client is considered stuck.
const writeTimeout = 5 * time.Second

// Handler upgrades a request to a WebSocket, joins it to the hub, streams state
// to it, and applies the commands it sends, until it disconnects.
func (h *Hub) Handler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			// Local dev only: the browser console and Vite dev server are other
			// origins. Tighten this before any public deploy.
			OriginPatterns: []string{"*"},
		})
		if err != nil {
			return
		}
		defer conn.CloseNow()

		ctx, cancel := context.WithCancel(r.Context())
		defer cancel()

		client := &Client{send: make(chan []byte, clientBuffer)}
		h.Register(client)
		defer h.Unregister(client)

		// pong carries ping timestamps from the reader to the writer. The writer
		// is the only goroutine that touches the socket and client.send, so the
		// reader hands echoes across rather than sending them itself.
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
				h.Submit(msg.Command)
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
}
