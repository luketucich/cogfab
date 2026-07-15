package server

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/luketucich/cogfab/internal/engine"
	"github.com/luketucich/cogfab/internal/wire"
)

func newTestWorld() *engine.World {
	w := engine.NewWorld(3, 1)
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

func TestRejectedWorldCommandReturnsCurrentStats(t *testing.T) {
	h := NewHub(engine.NewWorld(2, 1))
	c := &Client{send: make(chan []byte, 1)}
	cmd := wire.Command{Type: wire.CmdPlace, X: 3, Y: 0, Kind: wire.KindBelt, Dir: "east"}

	if h.handleCommand(clientCommand{c: c, cmd: cmd}) {
		t.Fatal("off-grid placement should be rejected")
	}
	var msg wire.StatsMessage
	if data := <-c.send; json.Unmarshal(data, &msg) != nil || msg.Type != "stats" {
		t.Fatalf("rejected command should return current stats, got %s", data)
	}
	if msg.IronOre != startingOre {
		t.Fatalf("returned iron ore = %d, want %d", msg.IronOre, startingOre)
	}
}

func TestBroadcastSendsToAllClients(t *testing.T) {
	h := NewHub(newTestWorld())
	c1 := &Client{send: make(chan []byte, 1)}
	c2 := &Client{send: make(chan []byte, 1)}
	h.clients[c1] = true
	h.clients[c2] = true

	h.broadcast([]byte("hello"))

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

func TestBroadcastDropsSlowClient(t *testing.T) {
	h := NewHub(newTestWorld())
	slow := &Client{send: make(chan []byte, 4)}
	h.addClient(slow)              // welcome, state, and stats occupy three slots
	slow.send <- []byte("backlog") // buffer is now full

	h.broadcast([]byte("next")) // can't enqueue -> the client is dropped

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
