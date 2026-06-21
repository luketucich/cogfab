// Package server runs the authoritative game: it owns the world, advances it on
// a fixed-rate loop, and streams each tick to connected WebSocket clients.
package server

import (
	"context"
	"encoding/json"
	"time"

	"github.com/luketucich/cogfab/internal/engine"
	"github.com/luketucich/cogfab/internal/wire"
)

const (
	// tickInterval is how often the world advances. Slow on purpose for now so
	// you can see items move tile by tile; the real target is faster.
	tickInterval = 250 * time.Millisecond

	// maxCatchUp clamps how much elapsed time we replay after a stall, so a slow
	// moment can't trigger an unbounded burst of steps.
	maxCatchUp = time.Second

	// clientBuffer is how many pending messages a client may queue before it is
	// treated as too slow and dropped.
	clientBuffer = 16
)

// Client is one connected viewer. The hub only knows its outbound queue; the
// WebSocket plumbing lives in the transport layer.
type Client struct {
	send chan []byte
}

// Hub owns the world and fans state out to clients. All access to the world and
// the client set happens on the single goroutine running Run, so there are no
// locks and no data races.
type Hub struct {
	world *engine.World
	tick  int

	clients    map[*Client]bool
	register   chan *Client
	unregister chan *Client
}

// NewHub creates a hub for the given world.
func NewHub(w *engine.World) *Hub {
	return &Hub{
		world:      w,
		clients:    make(map[*Client]bool),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
}

// Run drives the simulation until ctx is cancelled. It accumulates elapsed wall
// time rather than taking one step per ticker fire: if the loop falls behind,
// the elapsed time still drives the right number of steps, so no game-time is
// lost. On cancellation it disconnects every client.
func (h *Hub) Run(ctx context.Context) {
	ticker := time.NewTicker(tickInterval)
	defer ticker.Stop()

	last := time.Now()
	var acc time.Duration

	for {
		select {
		case <-ctx.Done():
			h.closeAll()
			return
		case c := <-h.register:
			h.addClient(c)
		case c := <-h.unregister:
			h.removeClient(c)
		case now := <-ticker.C:
			acc += now.Sub(last)
			last = now
			if acc > maxCatchUp {
				acc = maxCatchUp
			}
			for acc >= tickInterval {
				h.broadcast(h.stepAndEncode())
				acc -= tickInterval
			}
		}
	}
}

// Register and Unregister are called from client goroutines to join or leave.
func (h *Hub) Register(c *Client)   { h.register <- c }
func (h *Hub) Unregister(c *Client) { h.unregister <- c }

// stepAndEncode advances the world one tick and returns the JSON snapshot.
func (h *Hub) stepAndEncode() []byte {
	h.world.Step()
	h.tick++
	b, _ := json.Marshal(wire.Snapshot(h.world, h.tick)) // a fixed struct; marshal can't fail
	return b
}

// broadcast queues b to every client. A client whose buffer is full is too slow
// to keep up, so it is dropped rather than allowed to stall the tick loop.
func (h *Hub) broadcast(b []byte) {
	for c := range h.clients {
		select {
		case c.send <- b:
		default:
			h.removeClient(c)
		}
	}
}

// addClient adds a client and sends it the current state immediately, so it is
// not blank until the next tick.
func (h *Hub) addClient(c *Client) {
	h.clients[c] = true
	b, _ := json.Marshal(wire.Snapshot(h.world, h.tick))
	select {
	case c.send <- b:
	default:
	}
}

// removeClient drops a client and closes its queue (signalling its writer to stop).
func (h *Hub) removeClient(c *Client) {
	if h.clients[c] {
		delete(h.clients, c)
		close(c.send)
	}
}

func (h *Hub) closeAll() {
	for c := range h.clients {
		delete(h.clients, c)
		close(c.send)
	}
}
