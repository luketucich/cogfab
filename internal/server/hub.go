// Package server runs the authoritative game: it owns the world, streams it to
// connected WebSocket clients, and updates it when they send commands.
package server

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/luketucich/cogfab/internal/engine"
	"github.com/luketucich/cogfab/internal/wire"
)

// clientBuffer is how many pending messages a client may queue before it is
// treated as too slow and dropped.
const clientBuffer = 16

// Incremental updates stay comfortably below a full 64x64 snapshot at this
// size. Exceptional larger batches use the existing full-state path instead.
const maxTileUpdateBatch = 1024

// outboundMessage is the fixed metric label for one queued game payload.
type outboundMessage string

const (
	outboundWelcome      outboundMessage = "welcome"
	outboundState        outboundMessage = "state"
	outboundTiles        outboundMessage = "tiles"
	outboundActionResult outboundMessage = "actionResult"
	outboundStats        outboundMessage = "stats"
	outboundResources    outboundMessage = "resources"
	outboundPresence     outboundMessage = "presence"
	outboundCursor       outboundMessage = "cursor"
	outboundBuildPreview outboundMessage = "buildPreview"
)

// Client is one connected player: its outbound queue, identity, cursor, and
// temporary build preview. The WebSocket plumbing lives in the transport
// layer; these fields belong to the hub goroutine and need no locks.
type Client struct {
	send chan []byte

	protocol int // negotiated wire version; zero identifies tabs from before versioning

	slot  int    // 0-3; picks the default colour (PLAYER_COLORS in ui.ts)
	name  string // "Player N" until the player picks one
	color string // "" until the player picks one; then a #rrggbb

	onScreen bool    // the mouse is somewhere over the page
	screenX  float64 // mouse position in screen fractions
	screenY  float64
	hovering bool    // the mouse is over a grid cell
	hoverX   float64 // that spot in cell coordinates, fractional
	hoverY   float64
	preview  wire.BuildPreview
}

// clientCommand is a command plus who sent it. World commands ignore the
// sender (the factory is shared); hover and profile are about the sender.
type clientCommand struct {
	c           *Client
	cmd         wire.Command
	submittedAt time.Time // set only when metrics are enabled
}

// Hub owns the world and fans state out to clients. All access to the world and
// the client set happens on the single goroutine running Run, so there are no
// locks and no data races.
type Hub struct {
	world   *engine.World
	code    string   // the room code players joined with; sent in each welcome
	saves   *Saves   // where the room persists to; nil keeps it in memory only
	metrics *Metrics // nil when operational metrics are disabled

	credits int // authoritative purse: earned at sellers and spent on the factory

	extractorLevel int // global Extractor Rate level; higher emits material denser
	beltLevel      int // global Belt Speed level; higher carries material faster
	valueLevel     int // global Sale Value level; higher makes each delivery worth more
	refinerLevel   int // global Refiner Speed level; higher finishes jobs faster
	gridTier       int // index into gridTiers: how much of the world is unlocked

	routes      map[string]*route // live extractor-to-seller paths, for emitting material
	chunks      []*chunk          // material in flight on the belts
	refinerBusy map[int]*chunk    // refiner cell → chunk currently processing there

	clients    map[*Client]bool
	register   chan *Client
	unregister chan *Client
	commands   chan clientCommand
	done       chan struct{} // closed when Run exits, so the calls above never hang
}

// NewHub creates a hub for the given world.
func NewHub(w *engine.World) *Hub {
	h := &Hub{
		world:       w,
		credits:     startingCredits,
		routes:      make(map[string]*route),
		refinerBusy: make(map[int]*chunk),
		clients:     make(map[*Client]bool),
		register:    make(chan *Client),
		unregister:  make(chan *Client),
		commands:    make(chan clientCommand),
		done:        make(chan struct{}),
	}
	h.recompute()
	return h
}

// saveEvery is how often a live room attempts a disk save. Run also attempts a
// final save during a clean shutdown.
const saveEvery = 30 * time.Second

// Run is the hub's event loop: it applies and broadcasts each command right
// away, advances production once a second, and saves before a clean shutdown.
func (h *Hub) Run(ctx context.Context) {
	defer close(h.done)
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	saver := time.NewTicker(saveEvery)
	defer saver.Stop()
	for {
		select {
		case <-ctx.Done():
			h.persist()
			h.closeAll()
			return
		case c := <-h.register:
			h.addClient(c)
			h.broadcastPresence()
		case c := <-h.unregister:
			h.removeClient(c)
			h.broadcastPresence()
		case sub := <-h.commands:
			applied := h.handleCommand(sub)
			if !sub.submittedAt.IsZero() {
				h.metrics.commandProcessed(sub.cmd.Type, applied, time.Since(sub.submittedAt))
			}
		case <-ticker.C:
			if len(h.routes) > 0 || len(h.chunks) > 0 {
				h.runEconomyTick()
			}
		case <-saver.C:
			h.persist()
		}
	}
}

// runEconomyTick advances one active room and queues its updated stats.
func (h *Hub) runEconomyTick() {
	var started time.Time
	if h.metrics != nil {
		started = time.Now()
	}
	resourcesChanged := h.tick()
	h.broadcastStats()
	if resourcesChanged {
		h.broadcast(outboundResources, h.resourcesBytes())
	}
	if !started.IsZero() {
		h.metrics.economyTick(time.Since(started))
	}
}

// handleCommand applies one decoded room command and queues any state it
// changes. It reports whether the command produced a visible change.
func (h *Hub) handleCommand(sub clientCommand) bool {
	if !h.clients[sub.c] {
		return false
	}

	switch sub.cmd.Type {
	case wire.CmdHover:
		changed := h.applyHover(sub.c, sub.cmd)
		if changed {
			h.broadcastCursor(sub.c)
		}
		return changed
	case wire.CmdProfile:
		changed := h.applyProfile(sub.c, sub.cmd)
		if changed {
			h.broadcastPresence()
		}
		return changed
	case wire.CmdPreview:
		changed := h.applyPreview(sub.c, sub.cmd)
		if changed {
			h.broadcastPreview(sub.c)
		}
		return changed
	}
	if sub.cmd.Type == wire.CmdPlace || sub.cmd.Type == wire.CmdPlaceBatch {
		if h.clearPreview(sub.c) {
			h.broadcastPreview(sub.c)
		}
	}

	credits, rate := h.credits, h.currentRate()
	if !h.apply(sub.cmd) {
		if h.acknowledges(sub) && !h.sendActionResult(sub, false) {
			return false
		}
		// Return current stats so older clients clear their reserved credits and
		// current clients receive the complete authoritative economy snapshot.
		h.sendTo(sub.c, outboundStats, h.statsBytes())
		return false
	}
	worldChanged := false
	switch sub.cmd.Type {
	case wire.CmdPlace, wire.CmdPlaceBatch, wire.CmdDestroy, wire.CmdRotate:
		h.broadcastTileUpdates(sub.cmd)
		h.recompute()
		worldChanged = true
	case wire.CmdBuy:
		// Expanding the grid reveals new terrain. The other upgrades change only
		// the economy, so their stats message is enough.
		if sub.cmd.Upgrade == wire.UpgradeGridSize {
			h.broadcast(outboundState, h.stateBytes())
		}
	}
	acknowledged := false
	if worldChanged && h.acknowledges(sub) {
		acknowledged = h.sendActionResult(sub, true)
	}
	statsChanged := h.credits != credits || h.currentRate() != rate
	if statsChanged {
		h.broadcastStats() // the command spent credits or changed the rate
	} else if acknowledged {
		// Rotations still complete with the same result-then-stats ordering as
		// world actions that change the shared economy.
		h.sendTo(sub.c, outboundStats, h.statsBytes())
	}
	return true
}

func (h *Hub) acknowledges(sub clientCommand) bool {
	return sub.c.protocol >= predictedActionProtocol && sub.cmd.ActionID != 0 && isWorldCommand(sub.cmd.Type)
}

func isWorldCommand(command string) bool {
	switch command {
	case wire.CmdPlace, wire.CmdPlaceBatch, wire.CmdDestroy, wire.CmdRotate:
		return true
	default:
		return false
	}
}

func (h *Hub) sendActionResult(sub clientCommand, applied bool) bool {
	b, _ := json.Marshal(wire.ActionResultMessage{
		Type: "actionResult", ActionID: sub.cmd.ActionID, Applied: applied, Credits: h.credits,
	})
	return h.sendRequired(sub.c, outboundActionResult, b)
}

// persist attempts to write the room to disk. A failure is logged instead of
// stopping the game; a later scheduled save may retry.
func (h *Hub) persist() {
	if h.saves == nil {
		return
	}
	var started time.Time
	if h.metrics != nil {
		started = time.Now()
	}
	err := h.saves.save(h.code, h.snapshot())
	if !started.IsZero() {
		h.metrics.saveFinished(time.Since(started), err)
	}
	if err != nil {
		slog.Warn("saving room failed", "room", h.code, "err", err)
	}
}

// Register, Unregister, and Submit send client work to the Run goroutine. Each
// returns if Run has exited so a caller cannot hang during shutdown.
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
	sub := clientCommand{c: c, cmd: cmd}
	if h.metrics != nil {
		sub.submittedAt = time.Now()
	}
	select {
	case h.commands <- sub:
	case <-h.done:
	}
}

// apply runs one client command against the world and shared credits, reporting
// whether anything changed. A command the players cannot afford, cannot reach,
// or that makes no sense is ignored: the client greys those out up front, and
// the server never trusts it. The checks themselves live in shop.go.
func (h *Hub) apply(cmd wire.Command) bool {
	switch cmd.Type {
	case wire.CmdPlace:
		return h.applyPlace(cmd)
	case wire.CmdPlaceBatch:
		return h.applyPlaceBatch(cmd)
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
	x0, y0, x1, y1 := h.unlockedRect()
	b, _ := json.Marshal(wire.Snapshot(h.world, x0, y0, x1, y1))
	return b
}

// tileUpdatesBytes is the compact authoritative result of one world command.
func (h *Hub) tileUpdatesBytes(cmd wire.Command) []byte {
	cells := cmd.Placements
	if cmd.Type != wire.CmdPlaceBatch {
		cells = []wire.Placement{{X: cmd.X, Y: cmd.Y}}
	}
	b, _ := json.Marshal(wire.TileUpdates(h.world, cells))
	return b
}

// broadcastTileUpdates sends compact results to current clients and full state
// to tabs that connected before the tile-update protocol was introduced.
func (h *Hub) broadcastTileUpdates(cmd wire.Command) {
	if cmd.Type == wire.CmdPlaceBatch && len(cmd.Placements) > maxTileUpdateBatch {
		h.broadcast(outboundState, h.stateBytes())
		return
	}
	updates := h.tileUpdatesBytes(cmd)
	var state []byte
	for c := range h.clients {
		data := updates
		message := outboundTiles
		if c.protocol < tileUpdateProtocol {
			if state == nil {
				state = h.stateBytes()
			}
			data = state
			message = outboundState
		}
		h.queueBroadcast(c, message, data)
	}
}

func (h *Hub) resourcesBytes() []byte {
	x0, y0, x1, y1 := h.unlockedRect()
	b, _ := json.Marshal(wire.Resources(h.world, x0, y0, x1, y1))
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
		Credits:        h.credits,
		Rate:           h.currentRate(),
		ExtractorLevel: h.extractorLevel,
		ExtractorCost:  h.extractorCost(),
		BeltLevel:      h.beltLevel,
		BeltCost:       h.beltCost(),
		ValueLevel:     h.valueLevel,
		ValueCost:      h.valueCost(),
		RefinerLevel:   h.refinerLevel,
		RefinerCost:    h.refinerCost(),
		GridWidth:      x1 - x0 + 1,
		GridHeight:     y1 - y0 + 1,
		GridCost:       h.gridCost(),
		NextGridWidth:  nextW,
		NextGridHeight: nextH,
		Refiners:       h.refinerViews(),
	})
	return b
}

// broadcastStats sends the current economy to every client.
func (h *Hub) broadcastStats() {
	h.broadcast(outboundStats, h.statsBytes())
}

// broadcast queues a payload to every client. A client whose buffer is full is
// too slow to keep up, so it is dropped rather than allowed to stall the hub.
func (h *Hub) broadcast(message outboundMessage, payload []byte) {
	for c := range h.clients {
		h.queueBroadcast(c, message, payload)
	}
}

func (h *Hub) queueBroadcast(c *Client, message outboundMessage, payload []byte) {
	h.sendRequired(c, message, payload)
}

// sendRequired queues state needed to keep a client synchronized. A full queue
// disconnects the client so its next connection starts from a clean snapshot.
func (h *Hub) sendRequired(c *Client, message outboundMessage, payload []byte) bool {
	if !h.clients[c] {
		return false
	}
	select {
	case c.send <- payload:
		h.metrics.outboundQueued(message, len(payload))
		return true
	default:
		h.metrics.slowClientDisconnected()
		h.removeClient(c)
		return false
	}
}

// addClient seats a client in the lowest free colour slot and sends it its
// welcome, then the current world and economy, so it is not blank until
// something changes. (The caller broadcasts the new roster to everyone.)
func (h *Hub) addClient(c *Client) {
	c.slot = h.lowestFreeSlot()
	c.name = defaultName(c.slot)
	h.clients[c] = true
	h.metrics.playerConnected()
	h.sendTo(c, outboundWelcome, h.welcomeBytes(c))
	h.sendTo(c, outboundState, h.stateBytes())
	h.sendTo(c, outboundStats, h.statsBytes())
}

// sendTo queues one message to a single client, dropping it if the client's
// buffer is full (a client that stays behind is cleaned up on the next broadcast).
func (h *Hub) sendTo(c *Client, message outboundMessage, payload []byte) {
	select {
	case c.send <- payload:
		h.metrics.outboundQueued(message, len(payload))
	default:
	}
}

// removeClient drops a client and closes its queue (signalling its writer to stop).
func (h *Hub) removeClient(c *Client) {
	if h.clients[c] {
		delete(h.clients, c)
		close(c.send)
		h.metrics.playerDisconnected()
	}
}

// closeAll drops every remaining client on shutdown.
func (h *Hub) closeAll() {
	for c := range h.clients {
		h.removeClient(c)
	}
}
