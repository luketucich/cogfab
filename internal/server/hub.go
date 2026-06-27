// Package server runs the authoritative game: it owns the world, streams it to
// connected WebSocket clients, and updates it when they send commands.
package server

import (
	"context"
	"encoding/json"

	"github.com/luketucich/cogfab/internal/engine"
	"github.com/luketucich/cogfab/internal/wire"
)

// clientBuffer is how many pending messages a client may queue before it is
// treated as too slow and dropped.
const clientBuffer = 16

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

	clients    map[*Client]bool
	register   chan *Client
	unregister chan *Client
	commands   chan wire.Command
}

// NewHub creates a hub for the given world.
func NewHub(w *engine.World) *Hub {
	return &Hub{
		world:      w,
		clients:    make(map[*Client]bool),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		commands:   make(chan wire.Command),
	}
}

// Run owns the world until ctx is cancelled. There is nothing to simulate yet,
// so it just waits for events: clients joining or leaving, and commands that
// change the world. It broadcasts the new state right after each command, so a
// placement shows up immediately. On cancellation it disconnects every client.
func (h *Hub) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			h.closeAll()
			return
		case c := <-h.register:
			h.addClient(c)
		case c := <-h.unregister:
			h.removeClient(c)
		case cmd := <-h.commands:
			h.apply(cmd)
			h.broadcast(h.encode())
		}
	}
}

// Register, Unregister, and Submit are called from client goroutines; the work
// itself happens on the Run goroutine.
func (h *Hub) Register(c *Client) { h.register <- c }

func (h *Hub) Unregister(c *Client) { h.unregister <- c }

func (h *Hub) Submit(cmd wire.Command) { h.commands <- cmd }

// apply changes the world for one client command, ignoring anything it does not
// recognize. The world ignores off-grid coordinates, so the client's x and y
// need no checking here.
func (h *Hub) apply(cmd wire.Command) {
	switch cmd.Type {
	case wire.CmdPlace:
		dir := engine.ParseDirection(cmd.Dir)
		switch cmd.Kind {
		case wire.KindBelt:
			h.world.PlaceBelt(cmd.X, cmd.Y, dir)
		case wire.KindExtractor:
			h.world.PlaceExtractor(cmd.X, cmd.Y, dir)
		case wire.KindSeller:
			h.world.PlaceSeller(cmd.X, cmd.Y, dir)
		}
	case wire.CmdDestroy:
		h.world.Destroy(cmd.X, cmd.Y)
	}
}

// encode is the current world as a JSON state message.
func (h *Hub) encode() []byte {
	b, _ := json.Marshal(wire.Snapshot(h.world)) // a fixed struct; marshal can't fail
	return b
}

// broadcast queues b to every client. A client whose buffer is full is too slow
// to keep up, so it is dropped rather than allowed to stall the hub.
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
// not blank until something changes.
func (h *Hub) addClient(c *Client) {
	h.clients[c] = true
	select {
	case c.send <- h.encode():
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
