package server

import (
	"encoding/json"
	"testing"

	"github.com/luketucich/cogfab/internal/engine"
	"github.com/luketucich/cogfab/internal/wire"
	"github.com/prometheus/client_golang/prometheus/testutil"
)

func testProtocolClient(slot, protocol int) *Client {
	return &Client{
		send: make(chan []byte, 8), protocol: protocol,
		slot: slot, name: defaultName(slot),
	}
}

func TestCursorUpdatesUseEachRecipientsProtocol(t *testing.T) {
	h := NewHub(engine.NewWorld(2, 1))
	h.metrics = NewMetrics()
	source := testProtocolClient(0, compactPresenceProtocol)
	compact := testProtocolClient(1, compactPresenceProtocol)
	tileEra := testProtocolClient(2, tileUpdateProtocol)
	legacy := testProtocolClient(3, 0)
	for _, c := range []*Client{source, compact, tileEra, legacy} {
		h.clients[c] = true
	}

	cmd := wire.Command{
		Type: wire.CmdHover, On: true, SX: 0.25, SY: 0.75,
		Hovering: true, CX: 1.5, CY: 0.5,
	}
	if !h.handleCommand(clientCommand{c: source, cmd: cmd}) {
		t.Fatal("fresh cursor position was ignored")
	}
	if len(source.send) != 0 {
		t.Fatal("protocol 3 sender received its own compact cursor echo")
	}

	var cursor wire.CursorMessage
	if data := <-compact.send; json.Unmarshal(data, &cursor) != nil || cursor.Type != "cursor" {
		t.Fatalf("protocol 3 recipient got %s, want cursor", data)
	}
	if cursor.Slot != source.slot || cursor.SX != 0.25 || cursor.Y != 0.5 {
		t.Fatalf("cursor = %+v, want source position", cursor)
	}

	for _, c := range []*Client{tileEra, legacy} {
		var presence wire.PresenceMessage
		if data := <-c.send; json.Unmarshal(data, &presence) != nil || presence.Type != "presence" {
			t.Fatalf("protocol %d recipient got %s, want presence", c.protocol, data)
		}
		if len(presence.Players) != 4 || !presence.Players[0].Hovering {
			t.Fatalf("legacy presence = %+v, want four players and source hover", presence.Players)
		}
	}
	if got := testutil.ToFloat64(h.metrics.outboundMessages.WithLabelValues("cursor")); got != 1 {
		t.Errorf("compact cursor messages = %v, want 1", got)
	}
	if got := testutil.ToFloat64(h.metrics.outboundMessages.WithLabelValues("presence")); got != 2 {
		t.Errorf("legacy presence messages = %v, want 2", got)
	}
}

func TestPlacementBroadcastsCompactPreviewClear(t *testing.T) {
	h := NewHub(engine.NewWorld(2, 1))
	source := testProtocolClient(0, compactPresenceProtocol)
	compact := testProtocolClient(1, compactPresenceProtocol)
	tileEra := testProtocolClient(2, tileUpdateProtocol)
	for _, c := range []*Client{source, compact, tileEra} {
		h.clients[c] = true
	}

	preview := wire.Command{
		Type: wire.CmdPreview, Kind: wire.KindBelt,
		Placements: []wire.Placement{{X: 0, Y: 0, Dir: "east"}},
	}
	if !h.handleCommand(clientCommand{c: source, cmd: preview}) {
		t.Fatal("valid preview was rejected")
	}
	var shown wire.BuildPreviewMessage
	if data := <-compact.send; json.Unmarshal(data, &shown) != nil || shown.Type != "buildPreview" {
		t.Fatalf("protocol 3 recipient got %s, want buildPreview", data)
	}
	if shown.Slot != source.slot || shown.Preview == nil || shown.Preview.Kind != wire.KindBelt {
		t.Fatalf("preview = %+v, want source belt", shown)
	}
	<-tileEra.send // legacy full-roster preview

	place := wire.Command{Type: wire.CmdPlace, X: 0, Y: 0, Kind: wire.KindBelt, Dir: "east"}
	if !h.handleCommand(clientCommand{c: source, cmd: place}) {
		t.Fatal("valid placement was rejected")
	}
	var cleared wire.BuildPreviewMessage
	if data := <-compact.send; json.Unmarshal(data, &cleared) != nil || cleared.Type != "buildPreview" {
		t.Fatalf("first placement result = %s, want preview clear", data)
	}
	if cleared.Slot != source.slot || cleared.Preview != nil {
		t.Fatalf("preview clear = %+v, want source slot and null preview", cleared)
	}
	var presence wire.PresenceMessage
	if data := <-tileEra.send; json.Unmarshal(data, &presence) != nil || presence.Type != "presence" {
		t.Fatalf("protocol 2 clear = %s, want full presence", data)
	}
	if presence.Players[0].Preview != nil {
		t.Fatal("legacy full roster kept the placed preview")
	}

	var update wire.TileUpdateMessage
	if data := <-source.send; json.Unmarshal(data, &update) != nil || update.Type != "tiles" {
		t.Fatalf("protocol 3 sender first placement echo = %s, want tiles", data)
	}
}

func TestProfileChangesStillBroadcastFullRoster(t *testing.T) {
	h := NewHub(engine.NewWorld(1, 1))
	source := testProtocolClient(0, compactPresenceProtocol)
	compact := testProtocolClient(1, compactPresenceProtocol)
	legacy := testProtocolClient(2, tileUpdateProtocol)
	for _, c := range []*Client{source, compact, legacy} {
		h.clients[c] = true
	}

	cmd := wire.Command{Type: wire.CmdProfile, Name: "Luke", Color: "#5fd47a"}
	if !h.handleCommand(clientCommand{c: source, cmd: cmd}) {
		t.Fatal("valid profile change was ignored")
	}
	for _, c := range []*Client{source, compact, legacy} {
		var presence wire.PresenceMessage
		if data := <-c.send; json.Unmarshal(data, &presence) != nil || presence.Type != "presence" {
			t.Fatalf("protocol %d profile result = %s, want presence", c.protocol, data)
		}
		if presence.Players[0].Name != "Luke" || presence.Players[0].Color != "#5fd47a" {
			t.Fatalf("profile roster = %+v", presence.Players[0])
		}
	}
}

func TestCompactCursorPayloadStaysSmall(t *testing.T) {
	h := NewHub(engine.NewWorld(1, 1))
	source := testProtocolClient(0, compactPresenceProtocol)
	source.onScreen, source.screenX, source.screenY = true, 0.25, 0.75
	source.hovering, source.hoverX, source.hoverY = true, 0.5, 0.5
	for slot := 0; slot < maxPlayers; slot++ {
		c := source
		if slot > 0 {
			c = testProtocolClient(slot, compactPresenceProtocol)
		}
		h.clients[c] = true
	}

	compactSize := len(h.cursorBytes(source))
	fullSize := len(h.presenceBytes())
	if compactSize > 160 {
		t.Fatalf("cursor update is %d bytes, want at most 160", compactSize)
	}
	if compactSize*2 >= fullSize {
		t.Fatalf("cursor update is %d bytes vs %d-byte roster, want less than half", compactSize, fullSize)
	}
}
