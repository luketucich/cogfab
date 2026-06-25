package server

import (
	"encoding/json"
	"testing"

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

func TestEncodeProducesStateJSON(t *testing.T) {
	h := NewHub(newTestWorld())

	var msg wire.StateMessage
	if err := json.Unmarshal(h.encode(), &msg); err != nil {
		t.Fatalf("encoded bytes are not valid StateMessage JSON: %v", err)
	}
	if msg.Type != "state" {
		t.Errorf("Type = %q, want state", msg.Type)
	}
	if msg.Tiles[0].Kind != "extractor" {
		t.Errorf("tile (0,0) kind = %q, want extractor", msg.Tiles[0].Kind)
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

func TestBroadcastDropsSlowClient(t *testing.T) {
	h := NewHub(newTestWorld())
	slow := &Client{send: make(chan []byte, 1)}
	slow.send <- []byte("backlog") // buffer is now full
	h.clients[slow] = true

	h.broadcast([]byte("next")) // can't enqueue -> the client is dropped

	if h.clients[slow] {
		t.Error("slow client should have been dropped from the hub")
	}
	<-slow.send // drain the backlog
	if _, open := <-slow.send; open {
		t.Error("dropped client's send channel should be closed")
	}
}
