package server

import (
	"encoding/json"
	"sort"

	"github.com/luketucich/cogfab/internal/wire"
)

// Presence is the little social layer on top of the shared factory: who is in
// the room (by colour slot) and which cell each player is pointing at. It all
// runs on the hub goroutine, like everything else the hub owns.

// lowestFreeSlot picks the first colour slot no connected player holds. The
// registry admits at most maxPlayers connections and frees a seat only after
// the hub has let this client go, so a slot under maxPlayers always exists.
func (h *Hub) lowestFreeSlot() int {
	for slot := 0; ; slot++ {
		taken := false
		for c := range h.clients {
			if c.slot == slot {
				taken = true
				break
			}
		}
		if !taken {
			return slot
		}
	}
}

// applyHover records where a player is pointing, reporting whether anything
// changed so an unchanged hover does not re-broadcast the roster.
func (h *Hub) applyHover(c *Client, cmd wire.Command) bool {
	if c.hovering == cmd.Hovering && c.hoverX == cmd.X && c.hoverY == cmd.Y {
		return false
	}
	c.hovering, c.hoverX, c.hoverY = cmd.Hovering, cmd.X, cmd.Y
	return true
}

// welcomeBytes is the greeting for one client: its room code and its slot.
func (h *Hub) welcomeBytes(c *Client) []byte {
	b, _ := json.Marshal(wire.WelcomeMessage{Type: "welcome", Room: h.code, Slot: c.slot})
	return b
}

// presenceBytes is the room's full roster as a JSON presence message, ordered
// by slot so the output is stable.
func (h *Hub) presenceBytes() []byte {
	players := make([]wire.PresencePlayer, 0, len(h.clients))
	for c := range h.clients {
		players = append(players, wire.PresencePlayer{Slot: c.slot, Hovering: c.hovering, X: c.hoverX, Y: c.hoverY})
	}
	sort.Slice(players, func(i, j int) bool { return players[i].Slot < players[j].Slot })
	b, _ := json.Marshal(wire.PresenceMessage{Type: "presence", Players: players})
	return b
}

// broadcastPresence sends the current roster to everyone, sender included: each
// client filters its own slot for the cursors and uses the full list for the
// HUD dots.
func (h *Hub) broadcastPresence() {
	h.broadcast(h.presenceBytes())
}
