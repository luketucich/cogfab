package server

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/luketucich/cogfab/internal/wire"
)

func TestEndToEndClientReceivesState(t *testing.T) {
	hub := NewHub(newTestWorld())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go hub.Run(ctx)

	srv := httptest.NewServer(hub.Handler())
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")

	dialCtx, dialCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer dialCancel()
	conn, _, err := websocket.Dial(dialCtx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.CloseNow()

	readCtx, readCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer readCancel()
	_, data, err := conn.Read(readCtx)
	if err != nil {
		t.Fatalf("read: %v", err)
	}

	var msg wire.StateMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		t.Fatalf("payload is not a valid StateMessage: %v; raw=%s", err, data)
	}
	if msg.Type != "state" {
		t.Errorf("Type = %q, want state", msg.Type)
	}
	if msg.Width != 3 || msg.Height != 1 {
		t.Errorf("size = %dx%d, want 3x1", msg.Width, msg.Height)
	}
	if len(msg.Tiles) != 3 {
		t.Errorf("len(Tiles) = %d, want 3", len(msg.Tiles))
	}
}

func TestEndToEndPingIsEchoedAsPong(t *testing.T) {
	hub := NewHub(newTestWorld())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go hub.Run(ctx)

	srv := httptest.NewServer(hub.Handler())
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	dialCtx, dialCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer dialCancel()
	conn, _, err := websocket.Dial(dialCtx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.CloseNow()

	wctx, wcancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer wcancel()
	if err := conn.Write(wctx, websocket.MessageText, []byte(`{"type":"ping","t":123}`)); err != nil {
		t.Fatalf("write ping: %v", err)
	}

	// The welcome state and stats arrive first; read on until the pong shows up.
	for i := 0; i < 10; i++ {
		rctx, rcancel := context.WithTimeout(context.Background(), 5*time.Second)
		_, data, err := conn.Read(rctx)
		rcancel()
		if err != nil {
			t.Fatalf("read: %v", err)
		}
		var msg wire.PongMessage
		if json.Unmarshal(data, &msg) == nil && msg.Type == "pong" {
			if msg.T != 123 {
				t.Fatalf("pong t = %v, want 123", msg.T)
			}
			return
		}
	}
	t.Fatal("no pong received after 10 messages")
}
