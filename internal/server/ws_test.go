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
