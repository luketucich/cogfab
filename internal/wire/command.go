package wire

// A Command is something a client asks the server to do: place a structure,
// destroy one, rotate one, or buy an upgrade. The server decodes the JSON, looks at Type,
// and applies the matching action to the world. Keep this in sync by hand with
// the client types in web/src/net/types.ts; the two languages cannot share a
// file.

// Command types: the "type" string the client sends.
const (
	CmdPlace   = "place"
	CmdDestroy = "destroy"
	CmdRotate  = "rotate"  // turn the structure at (X, Y) a quarter clockwise
	CmdBuy     = "buy"     // purchase an upgrade; Upgrade says which
	CmdHover   = "hover"   // where this player's cursor is, for the other players
	CmdProfile = "profile" // the player's chosen name and colour
	CmdPing    = "ping"    // a round-trip probe the server echoes back; see ws.go
)

// Place kinds: the "kind" a place command carries. Mirrors the placeable tile
// kinds in the engine.
const (
	KindBelt      = "belt"
	KindExtractor = "extractor"
	KindSeller    = "seller"
)

// Upgrades: the "upgrade" a buy command carries.
const (
	UpgradeExtractorRate = "extractorRate"
	UpgradeBeltSpeed     = "beltSpeed"
	UpgradeOreValue      = "oreValue"
	UpgradeGridSize      = "gridSize"
)

// Command targets a cell (X, Y) with an action (Type). For a "place", Kind says
// which structure to place and Dir says which way it faces. For a "buy",
// Upgrade says which upgrade to purchase. For a "hover": SX/SY are the mouse in
// screen fractions (0.5, 0.5 is dead centre) with On saying whether it is over
// the page at all, and Hovering plus CX/CY say which grid spot it is over, in
// cell coordinates (3.4 is 40% into cell 3). For a "profile", Name and Color
// carry what the player picked for itself.
type Command struct {
	Type     string  `json:"type"`
	X        int     `json:"x"`
	Y        int     `json:"y"`
	Kind     string  `json:"kind"`
	Dir      string  `json:"dir"`
	Upgrade  string  `json:"upgrade"`
	Hovering bool    `json:"hovering"`
	CX       float64 `json:"cx"`
	CY       float64 `json:"cy"`
	SX       float64 `json:"sx"`
	SY       float64 `json:"sy"`
	On       bool    `json:"on"`
	Name     string  `json:"name"`
	Color    string  `json:"color"`
}
