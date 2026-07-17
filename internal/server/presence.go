package server

import (
	"encoding/json"
	"fmt"
	"slices"
	"sort"
	"strings"

	"github.com/luketucich/cogfab/internal/engine"
	"github.com/luketucich/cogfab/internal/wire"
)

// Presence is the social layer on top of the shared factory: identity, cursors,
// hovered cells, and temporary build previews. It all runs on the hub
// goroutine, like everything else the hub owns.

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
// changed so an unchanged cursor does not send another update.
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

// applyPreview keeps a bounded, well-formed build preview on the player. Bad
// input clears the old preview so a stale ghost cannot remain in the room.
func (h *Hub) applyPreview(c *Client, cmd wire.Command) bool {
	next, valid := h.buildPreview(cmd)
	if !valid {
		next = wire.BuildPreview{}
	}
	if c.preview.Kind == next.Kind && slices.Equal(c.preview.Placements, next.Placements) {
		return false
	}
	c.preview = next
	return true
}

func (h *Hub) clearPreview(c *Client) bool {
	return h.applyPreview(c, wire.Command{})
}

// buildPreview validates the small piece of untrusted presence data before it
// is echoed to the room. Preview cells may be locked or occupied because the
// authoritative placement command still makes the final decision.
func (h *Hub) buildPreview(cmd wire.Command) (wire.BuildPreview, bool) {
	if cmd.Kind == "" && len(cmd.Placements) == 0 {
		return wire.BuildPreview{}, true
	}
	if kindOf(cmd.Kind) == engine.Empty || len(cmd.Placements) == 0 ||
		len(cmd.Placements) > h.world.Width()*h.world.Height() {
		return wire.BuildPreview{}, false
	}
	seen := make(map[int]bool, len(cmd.Placements))
	for _, placement := range cmd.Placements {
		if placement.X < 0 || placement.X >= h.world.Width() ||
			placement.Y < 0 || placement.Y >= h.world.Height() ||
			!validDirection(placement.Dir) {
			return wire.BuildPreview{}, false
		}
		cell := placement.Y*h.world.Width() + placement.X
		if seen[cell] {
			return wire.BuildPreview{}, false
		}
		seen[cell] = true
	}
	return wire.BuildPreview{Kind: cmd.Kind, Placements: slices.Clone(cmd.Placements)}, true
}

func validDirection(dir string) bool {
	switch dir {
	case "north", "east", "south", "west":
		return true
	default:
		return false
	}
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
		player := wire.PresencePlayer{
			Slot: c.slot, Name: c.name, Color: c.color,
			On: c.onScreen, SX: c.screenX, SY: c.screenY,
			Hovering: c.hovering, X: c.hoverX, Y: c.hoverY,
		}
		if c.preview.Kind != "" {
			preview := c.preview
			player.Preview = &preview
		}
		players = append(players, player)
	}
	sort.Slice(players, func(i, j int) bool { return players[i].Slot < players[j].Slot })
	b, _ := json.Marshal(wire.PresenceMessage{Type: "presence", Players: players})
	return b
}

// cursorBytes is one player's latest pointer position for protocol 3 clients.
func (h *Hub) cursorBytes(c *Client) []byte {
	b, _ := json.Marshal(wire.CursorMessage{
		Type: "cursor", Slot: c.slot,
		On: c.onScreen, SX: c.screenX, SY: c.screenY,
		Hovering: c.hovering, X: c.hoverX, Y: c.hoverY,
	})
	return b
}

// previewBytes is one player's complete build ghost. An empty preview becomes
// JSON null so recipients remove any ghost they currently hold for that slot.
func (h *Hub) previewBytes(c *Client) []byte {
	var preview *wire.BuildPreview
	if c.preview.Kind != "" {
		current := c.preview
		preview = &current
	}
	b, _ := json.Marshal(wire.BuildPreviewMessage{
		Type: "buildPreview", Slot: c.slot, Preview: preview,
	})
	return b
}

// broadcastTransient sends a compact update to other protocol 3 clients while
// preserving the full-roster behavior expected by older tabs. The sender has
// already applied the change locally and does not need its compact echo.
func (h *Hub) broadcastTransient(source *Client, compact []byte) {
	var roster []byte
	for recipient := range h.clients {
		if recipient.protocol >= compactPresenceProtocol {
			if recipient != source {
				h.queueBroadcast(recipient, compact)
			}
			continue
		}
		if roster == nil {
			roster = h.presenceBytes()
		}
		h.queueBroadcast(recipient, roster)
	}
}

func (h *Hub) broadcastCursor(c *Client) {
	h.broadcastTransient(c, h.cursorBytes(c))
}

func (h *Hub) broadcastPreview(c *Client) {
	h.broadcastTransient(c, h.previewBytes(c))
}

// broadcastPresence sends the authoritative roster to every client after a
// join, leave, or profile change.
func (h *Hub) broadcastPresence() {
	h.broadcast(h.presenceBytes())
}

// defaultName is what a player is called until it picks something.
func defaultName(slot int) string {
	return fmt.Sprintf("Player %d", slot+1)
}
