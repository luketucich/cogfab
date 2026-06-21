package server

import (
	"encoding/json"
	"testing"

	"github.com/luketucich/cogfab/internal/engine"
	"github.com/luketucich/cogfab/internal/wire"
)

func newTestWorld() *engine.World {
	w := engine.NewWorld(3, 1)
	w.PlaceExtractor(0, 0, engine.East, 1) // emits every tick
	w.PlaceBelt(1, 0, engine.East)
	w.PlaceBelt(2, 0, engine.East)
	return w
}

func TestNewHubStartsAtTickZero(t *testing.T) {
	h := NewHub(newTestWorld())
	if h.tick != 0 {
		t.Errorf("tick = %d, want 0", h.tick)
	}
}

func TestStepAndEncodeAdvancesTickAndEncodesState(t *testing.T) {
	h := NewHub(newTestWorld())

	b := h.stepAndEncode()

	if h.tick != 1 {
		t.Errorf("tick = %d, want 1 after one step", h.tick)
	}
	var msg wire.StateMessage
	if err := json.Unmarshal(b, &msg); err != nil {
		t.Fatalf("encoded bytes are not valid StateMessage JSON: %v", err)
	}
	if msg.Type != "state" || msg.Tick != 1 {
		t.Errorf("msg = {Type:%q Tick:%d}, want {state 1}", msg.Type, msg.Tick)
	}
	if msg.Tiles[1].Item != "ore" {
		t.Errorf("after one step the extractor should emit; tile (1,0) item = %q, want ore", msg.Tiles[1].Item)
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
