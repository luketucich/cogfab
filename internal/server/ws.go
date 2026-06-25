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
				var cmd wire.Command
				if err := json.Unmarshal(data, &cmd); err != nil {
					continue
				}
				h.Submit(cmd)
			}
		}()

		// Writer: stream this client's queue to the socket until it closes or the
		// hub drops it.
		for {
			select {
			case <-ctx.Done():
				return
			case b, ok := <-client.send:
				if !ok {
					return
				}
				wctx, wcancel := context.WithTimeout(ctx, writeTimeout)
				err := conn.Write(wctx, websocket.MessageText, b)
				wcancel()
				if err != nil {
					return
				}
			}
		}
	}
}
