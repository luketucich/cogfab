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
	rooms := NewRooms(ctx, time.Minute, func(string) *engine.World { return newWorld() }, nil, nil)
	srv := httptest.NewServer(rooms.Handler())
	t.Cleanup(srv.Close)
	return "ws" + strings.TrimPrefix(srv.URL, "http")
}

func TestPlaceBatchBroadcastsOneCompactTileUpdate(t *testing.T) {
	url := newTestServerWithWorld(t, func() *engine.World {
		world := engine.NewWorld(3, 1)
		for x := 0; x < 3; x++ {
			world.SetDeposit(x, 0, engine.Iron, 4000)
		}
		return world
	})
	conn, read := dial(t, url+"?room=STROKE&protocol=2")
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

	var update wire.TileUpdateMessage
	if data := read(); json.Unmarshal(data, &update) != nil || update.Type != "tiles" {
		t.Fatalf("placement batch should broadcast tiles first, got %s", data)
	}
	if len(update.Tiles) != 3 {
		t.Fatalf("tile update has %d tiles, want 3", len(update.Tiles))
	}
	for i, tile := range update.Tiles {
		if tile.X != i || tile.Y != 0 || tile.Kind != wire.KindExtractor || tile.Dir != "east" {
			t.Errorf("tile %d = %+v, want east extractor", i, tile)
		}
	}
}

func TestLargeLegalPlaceBatchFitsTheReadLimit(t *testing.T) {
	const roomCode = "BAGBAT"
	saves := newTestSaves(t)
	seed := NewHub(NewResourceWorld(roomCode))
	seed.gridTier = len(gridTiers) - 1
	seed.credits = 1_000_000
	if err := saves.save(roomCode, seed.snapshot()); err != nil {
		t.Fatalf("save full-world room: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	rooms := NewRooms(ctx, time.Minute, NewResourceWorld, saves, nil)
	srv := httptest.NewServer(rooms.Handler())
	t.Cleanup(func() {
		srv.Close()
		cancel()
		rooms.Shutdown()
	})

	conn, read := dial(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"?room="+roomCode+"&protocol=2")
	readWelcome(t, read)
	read() // initial state
	read() // initial stats
	read() // initial presence

	placements := make([]wire.Placement, 0, resourceWorldSize*resourceWorldSize)
	for y := 0; y < seed.world.Height(); y++ {
		for x := 0; x < seed.world.Width(); x++ {
			if seed.terrainAllows(engine.Belt, x, y) {
				placements = append(placements, wire.Placement{X: x, Y: y, Dir: "east"})
			}
		}
	}
	command, err := json.Marshal(wire.Command{
		Type: wire.CmdPlaceBatch, Kind: wire.KindBelt, Placements: placements,
	})
	if err != nil {
		t.Fatalf("marshal placement batch: %v", err)
	}
	if len(command) <= 32<<10 || len(command) > clientReadLimit {
		t.Fatalf("placement batch is %d bytes, want over the default limit and within %d", len(command), clientReadLimit)
	}

	wctx, wcancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer wcancel()
	if err := conn.Write(wctx, websocket.MessageText, command); err != nil {
		t.Fatalf("write large placement batch: %v", err)
	}

	var state wire.StateMessage
	if data := read(); json.Unmarshal(data, &state) != nil || state.Type != "state" {
		t.Fatalf("large placement batch should fall back to full state, got %s", data)
	}
	placed := 0
	for _, tile := range state.Tiles {
		if tile.Kind == wire.KindBelt {
			placed++
		}
	}
	if placed != len(placements) {
		t.Fatalf("placed %d belts from a batch of %d", placed, len(placements))
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
	conn.SetReadLimit(1 << 20)
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

func readJoinBurst(t *testing.T, read func() []byte) {
	t.Helper()
	readWelcome(t, read)
	for _, want := range []string{"state", "stats", "presence"} {
		var envelope struct {
			Type string `json:"type"`
		}
		if data := read(); json.Unmarshal(data, &envelope) != nil || envelope.Type != want {
			t.Fatalf("join message = %s, want %s", data, want)
		}
	}
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

func TestLegacyClientReceivesFullStateAfterPlacement(t *testing.T) {
	url := newTestServerWithWorld(t, func() *engine.World { return engine.NewWorld(2, 1) })
	conn, read := dial(t, url+"?room=LEGACY")
	readWelcome(t, read)
	read() // initial state
	read() // initial stats
	read() // initial presence

	wctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := conn.Write(wctx, websocket.MessageText, []byte(`{"type":"place","x":0,"y":0,"kind":"belt","dir":"east"}`)); err != nil {
		t.Fatalf("write placement: %v", err)
	}

	var state wire.StateMessage
	if data := read(); json.Unmarshal(data, &state) != nil || state.Type != "state" {
		t.Fatalf("legacy placement result = %s, want full state", data)
	}
	if state.Tiles[0].Kind != wire.KindBelt {
		t.Fatalf("legacy tile = %+v, want belt", state.Tiles[0])
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

func TestMixedProtocolClientsReceiveCompatibleCursorUpdates(t *testing.T) {
	url := newTestServer(t)

	currentConn, currentRead := dial(t, url+"?room=M7XEDV&protocol=3")
	readJoinBurst(t, currentRead)
	_, futureRead := dial(t, url+"?room=M7XEDV&protocol=4")
	readJoinBurst(t, futureRead)
	currentRead() // full roster after the second player joined
	_, legacyRead := dial(t, url+"?room=M7XEDV&protocol=2")
	readJoinBurst(t, legacyRead)
	currentRead() // full roster after the legacy player joined
	futureRead()  // same roster for the other current player

	wctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	hover := []byte(`{"type":"hover","on":true,"sx":0.25,"sy":0.75,"hovering":true,"cx":1.5,"cy":0.5}`)
	if err := currentConn.Write(wctx, websocket.MessageText, hover); err != nil {
		t.Fatalf("write hover: %v", err)
	}

	var cursor wire.CursorMessage
	if data := futureRead(); json.Unmarshal(data, &cursor) != nil || cursor.Type != "cursor" {
		t.Fatalf("future client got %s, want cursor", data)
	}
	if cursor.Slot != 0 || cursor.SX != 0.25 || cursor.Y != 0.5 {
		t.Fatalf("cursor = %+v, want player 0 position", cursor)
	}
	var presence wire.PresenceMessage
	if data := legacyRead(); json.Unmarshal(data, &presence) != nil || presence.Type != "presence" {
		t.Fatalf("protocol 2 client got %s, want full presence", data)
	}
	if len(presence.Players) != 3 || !presence.Players[0].Hovering {
		t.Fatalf("legacy roster = %+v, want three players and source hover", presence.Players)
	}
}

func TestPlayersShareBuildPreviewsUntilPlacement(t *testing.T) {
	url := newTestServerWithWorld(t, func() *engine.World { return engine.NewWorld(3, 1) })
	connA, readA := dial(t, url+"?room=PREVUE&protocol=2")
	readWelcome(t, readA)
	_, readB := dial(t, url+"?room=PREVUE&protocol=2")
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
		var update wire.TileUpdateMessage
		if json.Unmarshal(data, &update) == nil && update.Type == "tiles" &&
			len(update.Tiles) == 1 && update.Tiles[0].Kind == wire.KindBelt {
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

func TestProtocolVersion(t *testing.T) {
	tests := map[string]int{
		"": 0, "0": 0, "2": 2, "3": 3, "99": 99,
		"-1": 0, "two": 0, "2.5": 0,
	}
	for raw, want := range tests {
		if got := protocolVersion(raw); got != want {
			t.Errorf("protocolVersion(%q) = %d, want %d", raw, got, want)
		}
	}
}
