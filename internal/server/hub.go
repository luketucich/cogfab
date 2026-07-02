// Package server runs the authoritative game: it owns the world, streams it to
// connected WebSocket clients, and updates it when they send commands.
package server

import (
	"context"
	"encoding/json"
	"time"

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

	ironOre    int // authoritative iron-ore total: earned at the seller, spent on builds
	ratePerSec int // ore delivered per second right now, shown in the HUD

	extractorLevel int // global Extractor Rate level; higher emits ore denser
	gridTier       int // index into gridTiers: how much of the world is unlocked

	routes map[string]*route // live extractor-to-seller paths, for emitting ore
	chunks []*chunk          // ore in flight on the belts

	clients    map[*Client]bool
	register   chan *Client
	unregister chan *Client
	commands   chan wire.Command
	done       chan struct{} // closed when Run exits, so the calls above never hang
}

// NewHub creates a hub for the given world.
func NewHub(w *engine.World) *Hub {
	h := &Hub{
		world:      w,
		ironOre:    startingOre,
		routes:     make(map[string]*route),
		clients:    make(map[*Client]bool),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		commands:   make(chan wire.Command),
		done:       make(chan struct{}),
	}
	h.recompute()
	return h
}

// Run is the hub's event loop: it applies and broadcasts each command right away
// (so a placement shows up at once) and accrues ore once a second. On ctx cancel
// it disconnects everyone.
func (h *Hub) Run(ctx context.Context) {
	defer close(h.done)
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
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
			if h.apply(cmd) {
				h.broadcast(h.stateBytes())
				h.recompute()
				h.broadcastStats() // commands move ore (costs, refunds, buys)
			}
		case <-ticker.C:
			if len(h.routes) > 0 || len(h.chunks) > 0 {
				h.tick()
				h.broadcastStats()
			} else if h.ratePerSec != 0 {
				h.ratePerSec = 0 // sim went idle: one last update so the HUD stops
				h.broadcastStats()
			}
		}
	}
}

// Register, Unregister, and Submit are called from client goroutines; the work
// itself happens on the Run goroutine. Each gives up once Run has exited, so a
// client caught mid-call during shutdown cannot hang forever.
func (h *Hub) Register(c *Client) {
	select {
	case h.register <- c:
	case <-h.done:
	}
}

func (h *Hub) Unregister(c *Client) {
	select {
	case h.unregister <- c:
	case <-h.done:
	}
}

func (h *Hub) Submit(cmd wire.Command) {
	select {
	case h.commands <- cmd:
	case <-h.done:
	}
}

// apply runs one client command against the world and the ore purse, reporting
// whether anything changed. A command the players cannot afford, cannot reach,
// or that makes no sense is ignored: the client greys those out up front, and
// the server never trusts it. The checks themselves live in shop.go.
func (h *Hub) apply(cmd wire.Command) bool {
	switch cmd.Type {
	case wire.CmdPlace:
		return h.applyPlace(cmd)
	case wire.CmdDestroy:
		return h.applyDestroy(cmd)
	case wire.CmdBuy:
		return h.applyBuy(cmd)
	}
	return false
}

// stateBytes is the current world as a JSON state message.
func (h *Hub) stateBytes() []byte {
	b, _ := json.Marshal(wire.Snapshot(h.world)) // a fixed struct; marshal can't fail
	return b
}

// statsBytes is the current economy as a JSON stats message.
func (h *Hub) statsBytes() []byte {
	x0, y0, x1, y1 := h.unlockedRect()
	b, _ := json.Marshal(wire.StatsMessage{
		Type:           "stats",
		IronOre:        h.ironOre,
		Rate:           h.ratePerSec,
		ExtractorLevel: h.extractorLevel,
		ExtractorCost:  h.extractorCost(),
		GridWidth:      x1 - x0 + 1,
		GridHeight:     y1 - y0 + 1,
		GridCost:       h.gridCost(),
	})
	return b
}

// broadcastStats sends the current economy to every client.
func (h *Hub) broadcastStats() {
	h.broadcast(h.statsBytes())
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

// addClient adds a client and sends it the current world and economy right away,
// so it is not blank until something changes.
func (h *Hub) addClient(c *Client) {
	h.clients[c] = true
	h.sendTo(c, h.stateBytes())
	h.sendTo(c, h.statsBytes())
}

// sendTo queues one message to a single client, dropping it if the client's
// buffer is full (a client that stays behind is cleaned up on the next broadcast).
func (h *Hub) sendTo(c *Client, b []byte) {
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
		h.removeClient(c)
	}
}
