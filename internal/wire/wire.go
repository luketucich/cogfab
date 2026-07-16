// Package wire is the JSON messages exchanged between the server and clients.
//
// It is built on top of the engine using only the engine's public methods, so
// the engine itself stays free of any networking or encoding concerns.
package wire

import "github.com/luketucich/cogfab/internal/engine"

// StateMessage is a full snapshot of the factory grid. Tiles are in row-major
// order (index = y*width + x), matching the engine's layout.
type StateMessage struct {
	Type     string        `json:"type"`
	Width    int           `json:"width"`
	Height   int           `json:"height"`
	Tiles    []TileView    `json:"tiles"`
	Deposits []DepositView `json:"deposits"`
	Ports    []CellView    `json:"ports"`
}

// TileView is one tile, with the enum values rendered as readable strings.
type TileView struct {
	Kind string `json:"kind"` // empty, belt, extractor, seller
	Dir  string `json:"dir"`  // north, east, south, west
}

// CellView identifies one sparse terrain feature in the world grid.
type CellView struct {
	X int `json:"x"`
	Y int `json:"y"`
}

// DepositView describes one visible resource deposit and its current stock.
type DepositView struct {
	X         int    `json:"x"`
	Y         int    `json:"y"`
	Kind      string `json:"kind"`
	Remaining int    `json:"remaining"`
	Capacity  int    `json:"capacity"`
}

// ResourcesMessage updates finite stock without resending the full grid.
type ResourcesMessage struct {
	Type     string        `json:"type"`
	Deposits []DepositView `json:"deposits"`
}

// StatsMessage is the economy update: the authoritative credit total, the
// current production rate, and where the upgrades stand. A cost of 0 means
// that upgrade is maxed out. Item motion is cosmetic and lives on the client.
type StatsMessage struct {
	Type           string  `json:"type"`
	Credits        int     `json:"credits"`
	Rate           float64 `json:"ratePerSec"` // production rate of the current routes
	ExtractorLevel int     `json:"extractorLevel"`
	ExtractorCost  int     `json:"extractorCost"`
	BeltLevel      int     `json:"beltLevel"`
	BeltCost       int     `json:"beltCost"`
	ValueLevel     int     `json:"valueLevel"`
	ValueCost      int     `json:"valueCost"`
	GridWidth      int     `json:"gridWidth"` // unlocked region, centred in the world
	GridHeight     int     `json:"gridHeight"`
	GridCost       int     `json:"gridCost"`
	NextGridWidth  int     `json:"nextGridWidth"` // the tier Grid Size buys next, 0 when maxed
	NextGridHeight int     `json:"nextGridHeight"`
}

// WelcomeMessage is the first thing a client hears after joining: which room it
// landed in (the client writes this into the page URL, making the address bar
// the invite link) and its player slot. The slot doubles as the player's colour
// and is not persistent: reconnecting may seat you in a different one.
type WelcomeMessage struct {
	Type string `json:"type"`
	Room string `json:"room"`
	Slot int    `json:"slot"`
}

// PresencePlayer describes one connected player, their cursor, and any
// temporary build preview. SX/SY are screen fractions and X/Y are grid
// coordinates. On marks the screen position valid; Hovering marks the grid
// position valid.
type PresencePlayer struct {
	Slot     int           `json:"slot"`
	Name     string        `json:"name"`
	Color    string        `json:"color"` // "" means use the slot's default colour
	On       bool          `json:"on"`
	SX       float64       `json:"sx"`
	SY       float64       `json:"sy"`
	Hovering bool          `json:"hovering"`
	X        float64       `json:"x"`
	Y        float64       `json:"y"`
	Preview  *BuildPreview `json:"preview,omitempty"`
}

// PresenceMessage is a room's full roster, sent whenever identity, cursor, or
// build-preview presence changes. Four players at most, so sending the whole
// list every time beats delta bookkeeping.
type PresenceMessage struct {
	Type    string           `json:"type"`
	Players []PresencePlayer `json:"players"`
}

// RoomFullMessage tells a joiner there is no seat: the room holds its four
// players already, or the server is at its room cap. The server closes after
// sending it, and the client must not reconnect to this room.
type RoomFullMessage struct {
	Type string `json:"type"`
}

// PongMessage answers a client ping with its own timestamp, so the client can
// measure the round-trip time to the server.
type PongMessage struct {
	Type string  `json:"type"`
	T    float64 `json:"t"`
}

// Pong builds a PongMessage echoing the client's timestamp t.
func Pong(t float64) PongMessage {
	return PongMessage{Type: "pong", T: t}
}

// Snapshot builds a state message while hiding terrain outside the unlocked
// rectangle. Buildings remain a full fixed-size grid for simple indexing.
func Snapshot(w *engine.World, x0, y0, x1, y1 int) StateMessage {
	width, height := w.Width(), w.Height()
	tiles := make([]TileView, 0, width*height)
	deposits := make([]DepositView, 0)
	ports := make([]CellView, 0)
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			t := w.At(x, y)
			tiles = append(tiles, TileView{
				Kind: t.Kind.String(),
				Dir:  t.Dir.String(),
			})
			if x < x0 || x > x1 || y < y0 || y > y1 {
				continue
			}
			if d := w.DepositAt(x, y); d.Kind != engine.NoResource {
				deposits = append(deposits, depositView(x, y, d))
			}
			if w.HasPort(x, y) {
				ports = append(ports, CellView{X: x, Y: y})
			}
		}
	}
	return StateMessage{
		Type:     "state",
		Width:    width,
		Height:   height,
		Tiles:    tiles,
		Deposits: deposits,
		Ports:    ports,
	}
}

// Resources builds the small stock update sent after active extractors run.
func Resources(w *engine.World, x0, y0, x1, y1 int) ResourcesMessage {
	deposits := make([]DepositView, 0)
	for y := y0; y <= y1; y++ {
		for x := x0; x <= x1; x++ {
			if d := w.DepositAt(x, y); d.Kind != engine.NoResource {
				deposits = append(deposits, depositView(x, y, d))
			}
		}
	}
	return ResourcesMessage{Type: "resources", Deposits: deposits}
}

func depositView(x, y int, d engine.Deposit) DepositView {
	return DepositView{
		X: x, Y: y, Kind: d.Kind.String(), Remaining: d.Remaining, Capacity: d.Capacity,
	}
}
