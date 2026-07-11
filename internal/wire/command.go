package wire

// Keep command constants and fields in sync with web/src/net/types.ts.

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

// Command is a client request selected by Type. Place uses X, Y, Kind, and Dir;
// buy uses Upgrade; hover uses On with SX/SY for the screen and Hovering with
// CX/CY for the grid; profile uses Name and Color.
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
