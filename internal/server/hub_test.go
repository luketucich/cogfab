package server

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/luketucich/cogfab/internal/engine"
	"github.com/luketucich/cogfab/internal/wire"
)

func newTestWorld() *engine.World {
	w := engine.NewWorld(3, 1)
	w.SetDeposit(0, 0, engine.Iron, 4000)
	w.PlaceExtractor(0, 0, engine.East)
	w.PlaceBelt(1, 0, engine.East)
	w.PlaceBelt(2, 0, engine.East)
	return w
}

func TestApplyPlacesAndDestroys(t *testing.T) {
	h := NewHub(engine.NewWorld(2, 1))

	h.apply(wire.Command{Type: wire.CmdPlace, X: 0, Y: 0, Kind: wire.KindBelt, Dir: "east"})
	if got := h.world.At(0, 0); got.Kind != engine.Belt || got.Dir != engine.East {
		t.Errorf("after place, got kind %v dir %v, want belt east", got.Kind, got.Dir)
	}

	h.apply(wire.Command{Type: wire.CmdDestroy, X: 0, Y: 0})
	if got := h.world.At(0, 0).Kind; got != engine.Empty {
		t.Errorf("after destroy, kind = %v, want empty", got)
	}
}

func TestStateBytesProducesStateJSON(t *testing.T) {
	h := NewHub(newTestWorld())

	var msg wire.StateMessage
	if err := json.Unmarshal(h.stateBytes(), &msg); err != nil {
		t.Fatalf("state bytes are not valid StateMessage JSON: %v", err)
	}
	if msg.Type != "state" {
		t.Errorf("Type = %q, want state", msg.Type)
	}
	if msg.Tiles[0].Kind != "extractor" {
		t.Errorf("tile (0,0) kind = %q, want extractor", msg.Tiles[0].Kind)
	}
}

func TestResourceWorldStatePayloadStaysBounded(t *testing.T) {
	h := NewHub(NewResourceWorld("PAYLOD"))
	h.gridTier = len(gridTiers) - 1
	if size := len(h.stateBytes()); size > 200_000 {
		t.Fatalf("full 64x64 state is %d bytes, want at most 200000", size)
	}
}

func TestWorldCommandsBroadcastAuthoritativeTileUpdates(t *testing.T) {
	tests := []struct {
		name       string
		world      func() *engine.World
		cmd        wire.Command
		want       []wire.TileUpdate
		wantFrames int
	}{
		{
			name:       "place",
			world:      func() *engine.World { return engine.NewWorld(2, 1) },
			cmd:        wire.Command{Type: wire.CmdPlace, X: 0, Y: 0, Kind: wire.KindBelt, Dir: "east"},
			want:       []wire.TileUpdate{{X: 0, Y: 0, Kind: wire.KindBelt, Dir: "east"}},
			wantFrames: 2, // tiles, then changed credits
		},
		{
			name:  "place batch",
			world: func() *engine.World { return engine.NewWorld(2, 1) },
			cmd: wire.Command{Type: wire.CmdPlaceBatch, Kind: wire.KindBelt, Placements: []wire.Placement{
				{X: 0, Y: 0, Dir: "east"},
				{X: 1, Y: 0, Dir: "south"},
			}},
			want: []wire.TileUpdate{
				{X: 0, Y: 0, Kind: wire.KindBelt, Dir: "east"},
				{X: 1, Y: 0, Kind: wire.KindBelt, Dir: "south"},
			},
			wantFrames: 2,
		},
		{
			name: "destroy",
			world: func() *engine.World {
				w := engine.NewWorld(2, 1)
				w.PlaceBelt(0, 0, engine.East)
				return w
			},
			cmd:        wire.Command{Type: wire.CmdDestroy, X: 0, Y: 0},
			want:       []wire.TileUpdate{{X: 0, Y: 0, Kind: "empty", Dir: "north"}},
			wantFrames: 2,
		},
		{
			name: "rotate",
			world: func() *engine.World {
				w := engine.NewWorld(2, 1)
				w.PlaceBelt(0, 0, engine.East)
				return w
			},
			cmd:        wire.Command{Type: wire.CmdRotate, X: 0, Y: 0},
			want:       []wire.TileUpdate{{X: 0, Y: 0, Kind: wire.KindBelt, Dir: "south"}},
			wantFrames: 1,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			h := NewHub(test.world())
			c := &Client{send: make(chan []byte, 4), protocol: tileUpdateProtocol}
			h.clients[c] = true

			if !h.handleCommand(clientCommand{c: c, cmd: test.cmd}) {
				t.Fatal("valid world command was rejected")
			}
			if len(c.send) != test.wantFrames {
				t.Fatalf("queued frames = %d, want %d", len(c.send), test.wantFrames)
			}
			var msg wire.TileUpdateMessage
			if data := <-c.send; json.Unmarshal(data, &msg) != nil || msg.Type != "tiles" {
				t.Fatalf("first command result = %s, want tiles", data)
			}
			if !reflect.DeepEqual(msg.Tiles, test.want) {
				t.Fatalf("tiles = %+v, want %+v", msg.Tiles, test.want)
			}
		})
	}
}

func TestTileUpdatesKeepLegacyClientsInSync(t *testing.T) {
	h := NewHub(engine.NewWorld(2, 1))
	legacy := &Client{send: make(chan []byte, 2)}
	current := &Client{send: make(chan []byte, 2), protocol: tileUpdateProtocol}
	h.clients[legacy] = true
	h.clients[current] = true

	cmd := wire.Command{Type: wire.CmdPlace, X: 0, Y: 0, Kind: wire.KindBelt, Dir: "east"}
	if !h.handleCommand(clientCommand{c: current, cmd: cmd}) {
		t.Fatal("valid placement was rejected")
	}

	var state wire.StateMessage
	if data := <-legacy.send; json.Unmarshal(data, &state) != nil || state.Type != "state" {
		t.Fatalf("legacy client result = %s, want full state", data)
	}
	if state.Tiles[0].Kind != wire.KindBelt {
		t.Fatalf("legacy tile = %+v, want belt", state.Tiles[0])
	}
	var update wire.TileUpdateMessage
	if data := <-current.send; json.Unmarshal(data, &update) != nil || update.Type != "tiles" {
		t.Fatalf("current client result = %s, want tile update", data)
	}
}

func TestProductionUpgradeBroadcastsOnlyStats(t *testing.T) {
	w := engine.NewWorld(3, 1)
	w.SetDeposit(0, 0, engine.Iron, 4_000)
	w.SetPort(2, 0, true)
	w.PlaceExtractor(0, 0, engine.East)
	w.PlaceBelt(1, 0, engine.East)
	w.PlaceSeller(2, 0, engine.West)
	h := NewHub(w)
	h.credits = 1_000
	c := &Client{send: make(chan []byte, 2)}
	h.clients[c] = true

	cmd := wire.Command{Type: wire.CmdBuy, Upgrade: wire.UpgradeExtractorRate}
	if !h.handleCommand(clientCommand{c: c, cmd: cmd}) {
		t.Fatal("affordable production upgrade was rejected")
	}
	if len(c.send) != 1 {
		t.Fatalf("queued frames = %d, want one stats update", len(c.send))
	}
	var stats wire.StatsMessage
	if data := <-c.send; json.Unmarshal(data, &stats) != nil || stats.Type != "stats" {
		t.Fatalf("production upgrade result = %s, want stats", data)
	}
}

func TestGridUpgradeBroadcastsFullStateAndStats(t *testing.T) {
	h := NewHub(NewResourceWorld("REVEAL"))
	h.credits = 1_000
	c := &Client{send: make(chan []byte, 2)}
	h.clients[c] = true

	cmd := wire.Command{Type: wire.CmdBuy, Upgrade: wire.UpgradeGridSize}
	if !h.handleCommand(clientCommand{c: c, cmd: cmd}) {
		t.Fatal("affordable grid upgrade was rejected")
	}
	var state wire.StateMessage
	if data := <-c.send; json.Unmarshal(data, &state) != nil || state.Type != "state" {
		t.Fatalf("grid upgrade first result = %s, want full state", data)
	}
	var stats wire.StatsMessage
	if data := <-c.send; json.Unmarshal(data, &stats) != nil || stats.Type != "stats" {
		t.Fatalf("grid upgrade second result = %s, want stats", data)
	}
	if stats.GridWidth != gridTiers[1].w || stats.GridHeight != gridTiers[1].h {
		t.Fatalf("unlocked grid = %dx%d, want %dx%d", stats.GridWidth, stats.GridHeight, gridTiers[1].w, gridTiers[1].h)
	}
}

func TestTileUpdatePayloadStaysSmall(t *testing.T) {
	h := NewHub(engine.NewWorld(resourceWorldSize, resourceWorldSize))
	placements := make([]wire.Placement, 0, resourceWorldSize)
	for x := 0; x < resourceWorldSize; x++ {
		h.world.PlaceBelt(x, 0, engine.East)
		placements = append(placements, wire.Placement{X: x, Y: 0, Dir: "east"})
	}
	cmd := wire.Command{Type: wire.CmdPlaceBatch, Kind: wire.KindBelt, Placements: placements}
	if size := len(h.tileUpdatesBytes(cmd)); size > 5_000 {
		t.Fatalf("64-tile update is %d bytes, want at most 5000", size)
	}
}

func TestEconomyTickBroadcastsResourceStockChanges(t *testing.T) {
	w := engine.NewWorld(3, 1)
	w.SetDeposit(0, 0, engine.Iron, 10)
	w.SetPort(2, 0, true)
	w.PlaceExtractor(0, 0, engine.East)
	w.PlaceBelt(1, 0, engine.East)
	w.PlaceSeller(2, 0, engine.West)
	h := NewHub(w)
	c := &Client{send: make(chan []byte, 2)}
	h.clients[c] = true

	h.runEconomyTick()
	var stats wire.StatsMessage
	if data := <-c.send; json.Unmarshal(data, &stats) != nil || stats.Type != "stats" {
		t.Fatalf("first tick message = %s, want stats", data)
	}
	var resources wire.ResourcesMessage
	if data := <-c.send; json.Unmarshal(data, &resources) != nil || resources.Type != "resources" {
		t.Fatalf("second tick message = %s, want resources", data)
	}
	if len(resources.Deposits) != 1 || resources.Deposits[0].Remaining >= 10 {
		t.Fatalf("resource update = %+v, want consumed stock", resources.Deposits)
	}
}

func TestRejectedWorldCommandReturnsCurrentStats(t *testing.T) {
	h := NewHub(engine.NewWorld(2, 1))
	c := &Client{
		send: make(chan []byte, 2),
		preview: wire.BuildPreview{
			Kind:       wire.KindBelt,
			Placements: []wire.Placement{{X: 0, Y: 0, Dir: "east"}},
		},
	}
	h.clients[c] = true
	cmd := wire.Command{Type: wire.CmdPlace, X: 3, Y: 0, Kind: wire.KindBelt, Dir: "east"}

	if h.handleCommand(clientCommand{c: c, cmd: cmd}) {
		t.Fatal("off-grid placement should be rejected")
	}
	var presence wire.PresenceMessage
	if data := <-c.send; json.Unmarshal(data, &presence) != nil || presence.Type != "presence" {
		t.Fatalf("rejected placement should clear its preview first, got %s", data)
	}
	if c.preview.Kind != "" {
		t.Fatal("rejected placement left its build preview behind")
	}
	var msg wire.StatsMessage
	if data := <-c.send; json.Unmarshal(data, &msg) != nil || msg.Type != "stats" {
		t.Fatalf("rejected command should return current stats, got %s", data)
	}
	if msg.Credits != startingCredits {
		t.Fatalf("returned credits = %d, want %d", msg.Credits, startingCredits)
	}
}

func TestPredictedWorldCommandReturnsOrderedSourceResult(t *testing.T) {
	h := NewHub(engine.NewWorld(2, 1))
	source := &Client{send: make(chan []byte, 4), protocol: predictedActionProtocol}
	peer := &Client{send: make(chan []byte, 4), protocol: predictedActionProtocol}
	h.clients[source] = true
	h.clients[peer] = true
	cmd := wire.Command{
		Type: wire.CmdPlace, ActionID: 42,
		X: 0, Y: 0, Kind: wire.KindBelt, Dir: "east",
	}

	if !h.handleCommand(clientCommand{c: source, cmd: cmd}) {
		t.Fatal("valid predicted placement was rejected")
	}

	var tiles wire.TileUpdateMessage
	if data := <-source.send; json.Unmarshal(data, &tiles) != nil || tiles.Type != "tiles" {
		t.Fatalf("source first result = %s, want tiles", data)
	}
	var result wire.ActionResultMessage
	if data := <-source.send; json.Unmarshal(data, &result) != nil || result.Type != "actionResult" {
		t.Fatalf("source second result = %s, want actionResult", data)
	}
	if result.ActionID != 42 || !result.Applied || result.Credits != startingCredits-buildCost[engine.Belt] {
		t.Fatalf("action result = %+v", result)
	}
	var stats wire.StatsMessage
	if data := <-source.send; json.Unmarshal(data, &stats) != nil || stats.Type != "stats" {
		t.Fatalf("source third result = %s, want stats", data)
	}

	if data := <-peer.send; json.Unmarshal(data, &tiles) != nil || tiles.Type != "tiles" {
		t.Fatalf("peer first result = %s, want tiles", data)
	}
	if data := <-peer.send; json.Unmarshal(data, &stats) != nil || stats.Type != "stats" {
		t.Fatalf("peer second result = %s, want stats", data)
	}
	if len(peer.send) != 0 {
		t.Fatal("peer received a source-only action result")
	}
}

func TestPredictedRotationStillEndsWithStats(t *testing.T) {
	w := engine.NewWorld(2, 1)
	w.PlaceBelt(0, 0, engine.East)
	h := NewHub(w)
	source := &Client{send: make(chan []byte, 3), protocol: predictedActionProtocol}
	h.clients[source] = true
	cmd := wire.Command{
		Type: wire.CmdRotate, ActionID: 7, X: 0, Y: 0,
		ExpectedKind: wire.KindBelt, ExpectedDir: "east",
	}

	if !h.handleCommand(clientCommand{c: source, cmd: cmd}) {
		t.Fatal("matching rotation was rejected")
	}
	for i, want := range []string{"tiles", "actionResult", "stats"} {
		var envelope struct {
			Type string `json:"type"`
		}
		if data := <-source.send; json.Unmarshal(data, &envelope) != nil || envelope.Type != want {
			t.Fatalf("frame %d = %s, want %s", i, data, want)
		}
	}
}

func TestRejectedPredictedCommandReturnsResultThenStats(t *testing.T) {
	h := NewHub(engine.NewWorld(2, 1))
	source := &Client{send: make(chan []byte, 2), protocol: predictedActionProtocol}
	peer := &Client{send: make(chan []byte, 1), protocol: predictedActionProtocol}
	h.clients[source] = true
	h.clients[peer] = true
	cmd := wire.Command{
		Type: wire.CmdPlace, ActionID: 99,
		X: 3, Y: 0, Kind: wire.KindBelt, Dir: "east",
	}

	if h.handleCommand(clientCommand{c: source, cmd: cmd}) {
		t.Fatal("off-grid placement should be rejected")
	}
	var result wire.ActionResultMessage
	if data := <-source.send; json.Unmarshal(data, &result) != nil || result.Type != "actionResult" {
		t.Fatalf("first rejection frame = %s, want actionResult", data)
	}
	if result.ActionID != 99 || result.Applied || result.Credits != startingCredits {
		t.Fatalf("rejected action result = %+v", result)
	}
	var stats wire.StatsMessage
	if data := <-source.send; json.Unmarshal(data, &stats) != nil || stats.Type != "stats" {
		t.Fatalf("second rejection frame = %s, want stats", data)
	}
	if len(peer.send) != 0 {
		t.Fatal("peer received a rejected action")
	}
}

func TestStalePredictedRotationReturnsRejectedResult(t *testing.T) {
	w := engine.NewWorld(2, 1)
	w.PlaceBelt(0, 0, engine.South)
	h := NewHub(w)
	source := &Client{send: make(chan []byte, 2), protocol: predictedActionProtocol}
	h.clients[source] = true
	cmd := wire.Command{
		Type: wire.CmdRotate, ActionID: 101, X: 0, Y: 0,
		ExpectedKind: wire.KindBelt, ExpectedDir: "east",
	}

	if h.handleCommand(clientCommand{c: source, cmd: cmd}) {
		t.Fatal("stale rotation should be rejected")
	}
	var result wire.ActionResultMessage
	if data := <-source.send; json.Unmarshal(data, &result) != nil || result.Type != "actionResult" || result.Applied {
		t.Fatalf("stale rotation result = %s", data)
	}
	if got := h.world.At(0, 0).Dir; got != engine.South {
		t.Fatalf("stale rotation changed direction to %v", got)
	}
}

func TestProtocolThreeIgnoresPredictionAcknowledgements(t *testing.T) {
	h := NewHub(engine.NewWorld(2, 1))
	source := &Client{send: make(chan []byte, 2), protocol: compactPresenceProtocol}
	h.clients[source] = true
	cmd := wire.Command{
		Type: wire.CmdPlace, ActionID: 5,
		X: 0, Y: 0, Kind: wire.KindBelt, Dir: "east",
	}

	if !h.handleCommand(clientCommand{c: source, cmd: cmd}) {
		t.Fatal("valid protocol 3 placement was rejected")
	}
	for i, want := range []string{"tiles", "stats"} {
		var envelope struct {
			Type string `json:"type"`
		}
		if data := <-source.send; json.Unmarshal(data, &envelope) != nil || envelope.Type != want {
			t.Fatalf("frame %d = %s, want %s", i, data, want)
		}
	}
}

func TestActionResultBackpressureDisconnectsForResync(t *testing.T) {
	w := engine.NewWorld(2, 1)
	w.PlaceBelt(0, 0, engine.East)
	h := NewHub(w)
	source := &Client{send: make(chan []byte, 1), protocol: predictedActionProtocol}
	h.clients[source] = true
	cmd := wire.Command{Type: wire.CmdRotate, ActionID: 6, X: 0, Y: 0}

	if !h.handleCommand(clientCommand{c: source, cmd: cmd}) {
		t.Fatal("valid rotation was rejected")
	}
	if h.clients[source] {
		t.Fatal("client that could not queue its action result stayed connected")
	}
	var tiles wire.TileUpdateMessage
	if data := <-source.send; json.Unmarshal(data, &tiles) != nil || tiles.Type != "tiles" {
		t.Fatalf("queued frame = %s, want authoritative tiles", data)
	}
	if _, open := <-source.send; open {
		t.Fatal("disconnected client's queue remained open")
	}
}

func TestDisconnectedClientCommandsAreIgnored(t *testing.T) {
	tests := []struct {
		name string
		cmd  wire.Command
	}{
		{
			name: "valid",
			cmd:  wire.Command{Type: wire.CmdPlace, X: 0, Y: 0, Kind: wire.KindBelt, Dir: "east"},
		},
		{
			name: "rejected",
			cmd:  wire.Command{Type: wire.CmdPlace, X: 3, Y: 0, Kind: wire.KindBelt, Dir: "east"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := NewHub(engine.NewWorld(2, 1))
			c := &Client{send: make(chan []byte, 1)}
			h.clients[c] = true
			h.removeClient(c)

			if h.handleCommand(clientCommand{c: c, cmd: tt.cmd}) {
				t.Fatal("disconnected client command should be ignored")
			}
			if got := h.world.At(0, 0).Kind; got != engine.Empty {
				t.Fatalf("disconnected client changed tile to %v", got)
			}
			if h.credits != startingCredits {
				t.Fatalf("disconnected client changed credits to %d", h.credits)
			}
		})
	}
}

func TestBroadcastSendsToAllClients(t *testing.T) {
	h := NewHub(newTestWorld())
	c1 := &Client{send: make(chan []byte, 1)}
	c2 := &Client{send: make(chan []byte, 1)}
	h.clients[c1] = true
	h.clients[c2] = true

	h.broadcast(outboundStats, []byte("hello"))

	for i, c := range []*Client{c1, c2} {
		select {
		case got := <-c.send:
			if string(got) != "hello" {
				t.Errorf("client %d got %q, want hello", i, got)
			}
		default:
			t.Errorf("client %d received nothing", i)
		}
	}
}

func TestClientsGetTheLowestFreeSlot(t *testing.T) {
	h := NewHub(newTestWorld())
	a := &Client{send: make(chan []byte, 8)}
	b := &Client{send: make(chan []byte, 8)}
	c := &Client{send: make(chan []byte, 8)}
	h.addClient(a)
	h.addClient(b)
	h.addClient(c)
	if a.slot != 0 || b.slot != 1 || c.slot != 2 {
		t.Fatalf("slots = %d %d %d, want 0 1 2", a.slot, b.slot, c.slot)
	}

	// b leaves; the next player takes the hole b left, not slot 3
	h.removeClient(b)
	d := &Client{send: make(chan []byte, 8)}
	h.addClient(d)
	if d.slot != 1 {
		t.Fatalf("slot = %d after refilling, want 1", d.slot)
	}
}

func TestPresenceRosterTracksHovers(t *testing.T) {
	h := NewHub(newTestWorld())
	a := &Client{send: make(chan []byte, 8)}
	b := &Client{send: make(chan []byte, 8)}
	h.addClient(a)
	h.addClient(b)

	if !h.applyHover(b, wire.Command{Type: wire.CmdHover, Hovering: true, CX: 2.5, CY: 0.25}) {
		t.Fatal("a fresh hover should count as a change")
	}
	if h.applyHover(b, wire.Command{Type: wire.CmdHover, Hovering: true, CX: 2.5, CY: 0.25}) {
		t.Fatal("repeating the same hover should not count as a change")
	}

	var msg wire.PresenceMessage
	if err := json.Unmarshal(h.presenceBytes(), &msg); err != nil {
		t.Fatalf("presence bytes are not valid JSON: %v", err)
	}
	if len(msg.Players) != 2 {
		t.Fatalf("roster has %d players, want 2", len(msg.Players))
	}
	if p := msg.Players[1]; p.Slot != 1 || !p.Hovering || p.X != 2.5 || p.Y != 0.25 {
		t.Fatalf("player 1 = %+v, want slot 1 hovering at (2.5, 0.25)", p)
	}
}

func TestProfilesAreSanitizedNotRejected(t *testing.T) {
	h := NewHub(newTestWorld())
	c := &Client{send: make(chan []byte, 8)}
	h.addClient(c)
	if c.name != "Player 1" {
		t.Fatalf("default name = %q, want Player 1", c.name)
	}

	if !h.applyProfile(c, wire.Command{Type: wire.CmdProfile, Name: "  Luke  ", Color: "#5fd47a"}) {
		t.Fatal("a real profile change should count as a change")
	}
	if c.name != "Luke" || c.color != "#5fd47a" {
		t.Fatalf("profile = %q %q, want Luke #5fd47a", c.name, c.color)
	}

	// Junk trims instead of erroring: a too-long name is cut, a bad colour and
	// an empty name keep what was there.
	h.applyProfile(c, wire.Command{Type: wire.CmdProfile, Name: "abcdefghijklmnopqrstuvwxyz", Color: "not-a-colour"})
	if c.name != "abcdefghijklmnop" || c.color != "#5fd47a" {
		t.Fatalf("after junk, profile = %q %q, want the name cut to 16 and the colour kept", c.name, c.color)
	}
	if h.applyProfile(c, wire.Command{Type: wire.CmdProfile, Name: "", Color: "zz"}) {
		t.Fatal("all-junk profile should change nothing")
	}
}

func TestPresenceRosterTracksBuildPreviews(t *testing.T) {
	h := NewHub(engine.NewWorld(4, 2))
	c := &Client{send: make(chan []byte, 8)}
	h.addClient(c)
	cmd := wire.Command{
		Type: wire.CmdPreview,
		Kind: wire.KindSeller,
		Placements: []wire.Placement{
			{X: 1, Y: 0, Dir: "east"},
			{X: 2, Y: 0, Dir: "south"},
		},
	}

	if !h.applyPreview(c, cmd) {
		t.Fatal("a fresh build preview should count as a change")
	}
	if h.applyPreview(c, cmd) {
		t.Fatal("repeating the same preview should not count as a change")
	}
	cmd.Placements[0].X = 3
	if c.preview.Placements[0].X != 1 {
		t.Fatal("the hub should keep its own copy of preview placements")
	}

	var msg wire.PresenceMessage
	if err := json.Unmarshal(h.presenceBytes(), &msg); err != nil {
		t.Fatal(err)
	}
	preview := msg.Players[0].Preview
	if preview == nil || preview.Kind != wire.KindSeller || len(preview.Placements) != 2 {
		t.Fatalf("presence preview = %+v, want two sellers", preview)
	}

	if !h.clearPreview(c) || c.preview.Kind != "" {
		t.Fatal("clearing a visible preview should remove it")
	}
	if h.clearPreview(c) {
		t.Fatal("clearing an empty preview should change nothing")
	}
}

func TestBuildPreviewRejectsUnsafeInput(t *testing.T) {
	h := NewHub(engine.NewWorld(3, 2))
	tests := []struct {
		name string
		cmd  wire.Command
	}{
		{"empty", wire.Command{Kind: wire.KindBelt}},
		{"unknown kind", wire.Command{Kind: "factory", Placements: []wire.Placement{{X: 0, Y: 0, Dir: "east"}}}},
		{"off grid", wire.Command{Kind: wire.KindBelt, Placements: []wire.Placement{{X: 3, Y: 0, Dir: "east"}}}},
		{"bad direction", wire.Command{Kind: wire.KindBelt, Placements: []wire.Placement{{X: 0, Y: 0, Dir: "sideways"}}}},
		{"duplicate", wire.Command{Kind: wire.KindBelt, Placements: []wire.Placement{{X: 0, Y: 0, Dir: "east"}, {X: 0, Y: 0, Dir: "east"}}}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if preview, valid := h.buildPreview(test.cmd); valid || preview.Kind != "" {
				t.Fatalf("unsafe preview accepted: %+v", preview)
			}
		})
	}
}

func TestBuildPreviewAllowsMachineBatches(t *testing.T) {
	h := NewHub(engine.NewWorld(3, 1))
	cmd := wire.Command{
		Kind: wire.KindExtractor,
		Placements: []wire.Placement{
			{X: 0, Y: 0, Dir: "east"},
			{X: 1, Y: 0, Dir: "east"},
		},
	}
	preview, valid := h.buildPreview(cmd)
	if !valid || preview.Kind != wire.KindExtractor || len(preview.Placements) != 2 {
		t.Fatalf("machine batch preview = %+v valid=%v, want two extractors", preview, valid)
	}
}

func TestInvalidBuildPreviewClearsPreviousIntent(t *testing.T) {
	h := NewHub(engine.NewWorld(2, 1))
	c := &Client{}
	valid := wire.Command{Kind: wire.KindBelt, Placements: []wire.Placement{{X: 0, Y: 0, Dir: "east"}}}
	invalid := wire.Command{Kind: wire.KindBelt, Placements: []wire.Placement{{X: 2, Y: 0, Dir: "east"}}}

	if !h.applyPreview(c, valid) || !h.applyPreview(c, invalid) {
		t.Fatal("new and cleared previews should both count as changes")
	}
	if c.preview.Kind != "" {
		t.Fatal("invalid preview left stale intent on the player")
	}
}

func TestBroadcastDropsSlowClient(t *testing.T) {
	h := NewHub(newTestWorld())
	slow := &Client{send: make(chan []byte, 4)}
	h.addClient(slow)              // welcome, state, and stats occupy three slots
	slow.send <- []byte("backlog") // buffer is now full

	h.broadcast(outboundStats, []byte("next")) // can't enqueue -> the client is dropped

	if h.clients[slow] {
		t.Error("slow client should have been dropped from the hub")
	}
	for i := 0; i < 4; i++ {
		select {
		case <-slow.send:
		case <-time.After(time.Second):
			t.Fatal("timed out draining the slow client's queued messages")
		}
	}
	select {
	case _, open := <-slow.send:
		if open {
			t.Error("dropped client's send channel should be closed")
		}
	case <-time.After(time.Second):
		t.Error("dropped client's send channel was not closed")
	}
}
