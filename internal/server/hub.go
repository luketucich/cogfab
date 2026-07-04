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

// Client is one connected player: its outbound queue, who it is, and where its
// mouse is. The WebSocket plumbing lives in the transport layer; the presence
// fields are read and written only on the hub goroutine, the same no-lock rule
// as everything else the hub owns.
type Client struct {
	send chan []byte

	slot  int    // 0-3; picks the default colour (PLAYER_COLORS in ui.ts)
	name  string // "Player N" until the player picks one
	color string // "" until the player picks one; then a #rrggbb

	onScreen bool    // the mouse is somewhere over the page
	screenX  float64 // mouse position in screen fractions
	screenY  float64
	hovering bool    // the mouse is over a grid cell
	hoverX   float64 // that spot in cell coordinates, fractional
	hoverY   float64
}

// clientCommand is a command plus who sent it. World commands ignore the
// sender (the factory is shared); hover is about the sender.
type clientCommand struct {
	c   *Client
	cmd wire.Command
}

// Hub owns the world and fans state out to clients. All access to the world and
// the client set happens on the single goroutine running Run, so there are no
// locks and no data races.
type Hub struct {
	world *engine.World
	code  string // the room code players joined with; sent in each welcome

	ironOre    int     // authoritative iron-ore total: earned at the seller, spent on builds
	orePartial float64 // fractional ore carried between ticks (chunk values go fractional past the sim cap)

	extractorLevel int // global Extractor Rate level; higher emits ore denser
	beltLevel      int // global Belt Speed level; higher carries ore faster
	valueLevel     int // global Ore Value level; higher makes each delivery worth more
	gridTier       int // index into gridTiers: how much of the world is unlocked

	routes map[string]*route // live extractor-to-seller paths, for emitting ore
	chunks []*chunk          // ore in flight on the belts

	clients    map[*Client]bool
	register   chan *Client
	unregister chan *Client
	commands   chan clientCommand
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
		commands:   make(chan clientCommand),
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
			h.broadcastPresence()
		case c := <-h.unregister:
			h.removeClient(c)
			h.broadcastPresence()
		case sub := <-h.commands:
			switch sub.cmd.Type {
			case wire.CmdHover:
				if h.applyHover(sub.c, sub.cmd) {
					h.broadcastPresence()
				}
				continue
			case wire.CmdProfile:
				if h.applyProfile(sub.c, sub.cmd) {
					h.broadcastPresence()
				}
				continue
			}
			ore, rate := h.ironOre, h.currentRate()
			if h.apply(sub.cmd) {
				h.broadcast(h.stateBytes())
				h.recompute()
				if h.ironOre != ore || h.currentRate() != rate {
					h.broadcastStats() // the command moved ore or changed the rate
				}
			}
		case <-ticker.C:
			if len(h.routes) > 0 || len(h.chunks) > 0 {
				h.tick()
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

func (h *Hub) Submit(c *Client, cmd wire.Command) {
	select {
	case h.commands <- clientCommand{c: c, cmd: cmd}:
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
	case wire.CmdRotate:
		return h.applyRotate(cmd)
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
	var nextW, nextH int
	if h.gridTier < len(gridTiers)-1 {
		next := gridTiers[h.gridTier+1]
		nextW, nextH = next.w, next.h
	}
	b, _ := json.Marshal(wire.StatsMessage{
		Type:           "stats",
		IronOre:        h.ironOre,
		Rate:           h.currentRate(),
		ExtractorLevel: h.extractorLevel,
		ExtractorCost:  h.extractorCost(),
		BeltLevel:      h.beltLevel,
		BeltCost:       h.beltCost(),
		ValueLevel:     h.valueLevel,
		ValueCost:      h.valueCost(),
		GridWidth:      x1 - x0 + 1,
		GridHeight:     y1 - y0 + 1,
		GridCost:       h.gridCost(),
		NextGridWidth:  nextW,
		NextGridHeight: nextH,
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

// addClient seats a client in the lowest free colour slot and sends it its
// welcome, then the current world and economy, so it is not blank until
// something changes. (The caller broadcasts the new roster to everyone.)
func (h *Hub) addClient(c *Client) {
	c.slot = h.lowestFreeSlot()
	c.name = defaultName(c.slot)
	h.clients[c] = true
	h.sendTo(c, h.welcomeBytes(c))
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
