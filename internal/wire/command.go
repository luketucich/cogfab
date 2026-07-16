package wire

// Keep command constants and fields in sync with web/src/net/types.ts.

// Command types: the "type" string the client sends.
const (
	CmdPlace      = "place"
	CmdPlaceBatch = "placeBatch"
	CmdPreview    = "preview" // temporary build intent shared with the room
	CmdDestroy    = "destroy"
	CmdRotate     = "rotate"  // turn the structure at (X, Y) a quarter clockwise
	CmdBuy        = "buy"     // purchase an upgrade; Upgrade says which
	CmdHover      = "hover"   // where this player's cursor is, for the other players
	CmdProfile    = "profile" // the player's chosen name and colour
	CmdPing       = "ping"    // a round-trip probe the server echoes back; see ws.go
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
	UpgradeSaleValue     = "oreValue" // keep the deployed wire value compatible
	UpgradeGridSize      = "gridSize"
)

// Placement is one requested cell in an atomic placement batch.
type Placement struct {
	X   int    `json:"x"`
	Y   int    `json:"y"`
	Dir string `json:"dir"`
}

// BuildPreview is a player's temporary, uncommitted build intent. It is shared
// through presence and never written into room state.
type BuildPreview struct {
	Kind       string      `json:"kind"`
	Placements []Placement `json:"placements"`
}

// Command is a client request selected by Type. Place uses X, Y, Kind, and Dir;
// placeBatch and preview use Placements; buy uses Upgrade; hover uses On with
// SX/SY for the screen and Hovering with CX/CY for the grid; profile uses Name
// and Color.
type Command struct {
	Type       string      `json:"type"`
	X          int         `json:"x"`
	Y          int         `json:"y"`
	Kind       string      `json:"kind"`
	Dir        string      `json:"dir"`
	Placements []Placement `json:"placements"`
	Upgrade    string      `json:"upgrade"`
	Hovering   bool        `json:"hovering"`
	CX         float64     `json:"cx"`
	CY         float64     `json:"cy"`
	SX         float64     `json:"sx"`
	SY         float64     `json:"sy"`
	On         bool        `json:"on"`
	Name       string      `json:"name"`
	Color      string      `json:"color"`
}
