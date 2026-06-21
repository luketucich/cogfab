package server

import (
	"context"
	"net/http"
	"time"

	"github.com/coder/websocket"
)

// writeTimeout bounds how long a single message write may take before the
// client is considered stuck.
const writeTimeout = 5 * time.Second

// Handler upgrades a request to a WebSocket, joins it to the hub, and streams
// state to it until it disconnects. No client-to-server messages are expected
// yet, but we keep reading so control frames (ping/pong/close) are handled.
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

		// Reader: drain incoming frames so control frames are processed; on any
		// read error (including the client closing) tear the connection down.
		go func() {
			for {
				if _, _, err := conn.Read(ctx); err != nil {
					cancel()
					return
				}
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
