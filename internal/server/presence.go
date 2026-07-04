package server

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/luketucich/cogfab/internal/wire"
)

// Presence is the little social layer on top of the shared factory: who is in
// the room (name and colour), where each player's mouse is on their screen (for
// the named cursors), and which grid spot it is over (for the cell markers).
// It all runs on the hub goroutine, like everything else the hub owns.

// maxNameLength keeps names to nametag size.
const maxNameLength = 16

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

// applyHover records where a player's mouse is, reporting whether anything
// changed so an unchanged cursor does not re-broadcast the roster.
func (h *Hub) applyHover(c *Client, cmd wire.Command) bool {
	if c.onScreen == cmd.On && c.screenX == cmd.SX && c.screenY == cmd.SY &&
		c.hovering == cmd.Hovering && c.hoverX == cmd.CX && c.hoverY == cmd.CY {
		return false
	}
	c.onScreen, c.screenX, c.screenY = cmd.On, cmd.SX, cmd.SY
	c.hovering, c.hoverX, c.hoverY = cmd.Hovering, cmd.CX, cmd.CY
	return true
}

// applyProfile records the name and colour a player picked for itself,
// reporting whether anything changed. Junk is trimmed rather than rejected: a
// name is cut to nametag size and a colour that is not #rrggbb is ignored.
func (h *Hub) applyProfile(c *Client, cmd wire.Command) bool {
	name := strings.TrimSpace(cmd.Name)
	if runes := []rune(name); len(runes) > maxNameLength {
		name = string(runes[:maxNameLength])
	}
	color := cmd.Color
	if !validColor(color) {
		color = c.color
	}
	if name == "" {
		name = c.name
	}
	if name == c.name && color == c.color {
		return false
	}
	c.name, c.color = name, color
	return true
}

// validColor reports whether a client-supplied colour is a #rrggbb value.
func validColor(color string) bool {
	if len(color) != 7 || color[0] != '#' {
		return false
	}
	for _, r := range color[1:] {
		if !strings.ContainsRune("0123456789abcdefABCDEF", r) {
			return false
		}
	}
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
		players = append(players, wire.PresencePlayer{
			Slot: c.slot, Name: c.name, Color: c.color,
			On: c.onScreen, SX: c.screenX, SY: c.screenY,
			Hovering: c.hovering, X: c.hoverX, Y: c.hoverY,
		})
	}
	sort.Slice(players, func(i, j int) bool { return players[i].Slot < players[j].Slot })
	b, _ := json.Marshal(wire.PresenceMessage{Type: "presence", Players: players})
	return b
}

// broadcastPresence sends the current roster to everyone, sender included: each
// client filters its own slot for the cursors and uses the full list for the
// lobby panel.
func (h *Hub) broadcastPresence() {
	h.broadcast(h.presenceBytes())
}

// defaultName is what a player is called until it picks something.
func defaultName(slot int) string {
	return fmt.Sprintf("Player %d", slot+1)
}
