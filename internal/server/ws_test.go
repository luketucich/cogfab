package server

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/luketucich/cogfab/internal/engine"
	"github.com/luketucich/cogfab/internal/wire"
)

// newTestServer runs a registry-backed server over tiny test worlds and
// returns its WebSocket base URL. Dial it with "?room=CODE" to pick a room.
func newTestServer(t *testing.T) string {
	return newTestServerWithWorld(t, newTestWorld)
}

func newTestServerWithWorld(t *testing.T, newWorld func() *engine.World) string {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	rooms := NewRooms(ctx, time.Minute, newWorld, nil, nil)
	srv := httptest.NewServer(rooms.Handler())
	t.Cleanup(srv.Close)
	return "ws" + strings.TrimPrefix(srv.URL, "http")
}

func TestPlaceBatchBroadcastsOneCompleteState(t *testing.T) {
	url := newTestServerWithWorld(t, func() *engine.World { return engine.NewWorld(3, 1) })
	conn, read := dial(t, url+"?room=STROKE")
	readWelcome(t, read)
	read() // initial state
	read() // initial stats
	read() // initial presence

	wctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	err := conn.Write(wctx, websocket.MessageText, []byte(`{
		"type":"placeBatch",
		"kind":"extractor",
		"placements":[
			{"x":0,"y":0,"dir":"east"},
			{"x":1,"y":0,"dir":"east"},
			{"x":2,"y":0,"dir":"east"}
		]
	}`))
	if err != nil {
		t.Fatalf("write placement batch: %v", err)
	}

	var state wire.StateMessage
	if data := read(); json.Unmarshal(data, &state) != nil || state.Type != "state" {
		t.Fatalf("placement batch should broadcast state first, got %s", data)
	}
	for i, tile := range state.Tiles {
		if tile.Kind != wire.KindExtractor || tile.Dir != "east" {
			t.Errorf("tile %d = %+v, want east extractor", i, tile)
		}
	}
}

// dial connects to a test server and hands back the conn and a read helper
// that fails the test on error.
func dial(t *testing.T, url string) (*websocket.Conn, func() []byte) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)
	conn, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		t.Fatalf("dial %s: %v", url, err)
	}
	t.Cleanup(func() { _ = conn.CloseNow() })
	read := func() []byte {
		rctx, rcancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer rcancel()
		_, data, err := conn.Read(rctx)
		if err != nil {
			t.Fatalf("read: %v", err)
		}
		return data
	}
	return conn, read
}

// readWelcome reads messages until the welcome arrives and returns it.
func readWelcome(t *testing.T, read func() []byte) wire.WelcomeMessage {
	t.Helper()
	for i := 0; i < 10; i++ {
		var msg wire.WelcomeMessage
		if data := read(); json.Unmarshal(data, &msg) == nil && msg.Type == "welcome" {
			return msg
		}
	}
	t.Fatal("no welcome within 10 messages")
	return wire.WelcomeMessage{}
}

func TestEndToEndClientReceivesWelcomeThenState(t *testing.T) {
	url := newTestServer(t)
	_, read := dial(t, url)

	// The welcome comes first, carrying a freshly minted room code.
	var welcome wire.WelcomeMessage
	if data := read(); json.Unmarshal(data, &welcome) != nil || welcome.Type != "welcome" {
		t.Fatalf("first message should be a welcome, got %s", data)
	}
	if !validCode(welcome.Room) {
		t.Errorf("welcome carries room %q, not a valid code", welcome.Room)
	}
	if welcome.Slot != 0 {
		t.Errorf("first player got slot %d, want 0", welcome.Slot)
	}

	var state wire.StateMessage
	if data := read(); json.Unmarshal(data, &state) != nil || state.Type != "state" {
		t.Fatalf("second message should be the state, got %s", data)
	}
	if state.Width != 3 || state.Height != 1 || len(state.Tiles) != 3 {
		t.Errorf("state = %dx%d with %d tiles, want 3x1 with 3", state.Width, state.Height, len(state.Tiles))
	}
}

func TestEndToEndPingIsEchoedAsPong(t *testing.T) {
	url := newTestServer(t)
	conn, read := dial(t, url)

	wctx, wcancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer wcancel()
	if err := conn.Write(wctx, websocket.MessageText, []byte(`{"type":"ping","t":123}`)); err != nil {
		t.Fatalf("write ping: %v", err)
	}

	// The join burst comes first; read on until the pong shows up.
	for i := 0; i < 10; i++ {
		var msg wire.PongMessage
		if data := read(); json.Unmarshal(data, &msg) == nil && msg.Type == "pong" {
			if msg.T != 123 {
				t.Fatalf("pong t = %v, want 123", msg.T)
			}
			return
		}
	}
	t.Fatal("no pong received after 10 messages")
}

func TestPlayersShareARoomAndSeeEachOthersHover(t *testing.T) {
	url := newTestServer(t)

	connA, readA := dial(t, url+"?room=TESTAA")
	if w := readWelcome(t, readA); w.Room != "TESTAA" || w.Slot != 0 {
		t.Fatalf("player A welcome = %+v, want room TESTAA slot 0", w)
	}
	_, readB := dial(t, url+"?room=TESTAA")
	if w := readWelcome(t, readB); w.Room != "TESTAA" || w.Slot != 1 {
		t.Fatalf("player B welcome = %+v, want room TESTAA slot 1", w)
	}

	wctx, wcancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer wcancel()
	if err := connA.Write(wctx, websocket.MessageText, []byte(`{"type":"hover","hovering":true,"cx":1.5,"cy":0.5}`)); err != nil {
		t.Fatalf("write hover: %v", err)
	}

	// B reads until the roster shows A's cursor at (1.5, 0.5).
	for i := 0; i < 10; i++ {
		var msg wire.PresenceMessage
		if data := readB(); json.Unmarshal(data, &msg) != nil || msg.Type != "presence" {
			continue
		} else {
			for _, p := range msg.Players {
				if p.Slot == 0 && p.Hovering && p.X == 1.5 && p.Y == 0.5 {
					return
				}
			}
		}
	}
	t.Fatal("player B never saw player A's hover")
}

func TestPlayersShareBuildPreviewsUntilPlacement(t *testing.T) {
	url := newTestServerWithWorld(t, func() *engine.World { return engine.NewWorld(3, 1) })
	connA, readA := dial(t, url+"?room=PREVUE")
	readWelcome(t, readA)
	_, readB := dial(t, url+"?room=PREVUE")
	readWelcome(t, readB)

	wctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	preview := `{"type":"preview","kind":"belt","placements":[{"x":0,"y":0,"dir":"east"}]}`
	if err := connA.Write(wctx, websocket.MessageText, []byte(preview)); err != nil {
		t.Fatalf("write preview: %v", err)
	}

	for i := 0; i < 12; i++ {
		var msg wire.PresenceMessage
		if data := readB(); json.Unmarshal(data, &msg) != nil || msg.Type != "presence" {
			continue
		}
		for _, player := range msg.Players {
			if player.Slot == 0 && player.Preview != nil && player.Preview.Kind == wire.KindBelt {
				goto previewSeen
			}
		}
	}
	t.Fatal("player B never saw player A's build preview")

previewSeen:
	place := `{"type":"place","x":0,"y":0,"kind":"belt","dir":"east"}`
	if err := connA.Write(wctx, websocket.MessageText, []byte(place)); err != nil {
		t.Fatalf("write place: %v", err)
	}

	cleared, placed := false, false
	for i := 0; i < 12 && (!cleared || !placed); i++ {
		data := readB()
		var presence wire.PresenceMessage
		if json.Unmarshal(data, &presence) == nil && presence.Type == "presence" {
			for _, player := range presence.Players {
				if player.Slot == 0 && player.Preview == nil {
					cleared = true
				}
			}
		}
		var state wire.StateMessage
		if json.Unmarshal(data, &state) == nil && state.Type == "state" && state.Tiles[0].Kind == wire.KindBelt {
			placed = true
		}
	}
	if !cleared || !placed {
		t.Fatalf("after placement: preview cleared = %v, belt placed = %v", cleared, placed)
	}
}

func TestRoomsAreIsolated(t *testing.T) {
	url := newTestServer(t)

	connA, readA := dial(t, url+"?room=AAAAAA")
	readWelcome(t, readA)
	connB, readB := dial(t, url+"?room=BBBBBB")
	readWelcome(t, readB)
	readB() // state
	readB() // stats
	readB() // presence
	_ = connB

	// A changes its world; nothing about it may reach B's room.
	wctx, wcancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer wcancel()
	if err := connA.Write(wctx, websocket.MessageText, []byte(`{"type":"destroy","x":2,"y":0}`)); err != nil {
		t.Fatalf("write destroy: %v", err)
	}

	rctx, rcancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer rcancel()
	if _, data, err := connB.Read(rctx); err == nil {
		t.Fatalf("player B received %s from another room; rooms must be isolated", data)
	}
}

func TestFifthPlayerIsRefused(t *testing.T) {
	url := newTestServer(t)

	for i := 0; i < maxPlayers; i++ {
		_, read := dial(t, url+"?room=PACKED")
		readWelcome(t, read)
	}

	_, read := dial(t, url+"?room=PACKED")
	var msg wire.RoomFullMessage
	if data := read(); json.Unmarshal(data, &msg) != nil || msg.Type != "roomFull" {
		t.Fatalf("fifth player should hear roomFull, got %s", data)
	}
}
