package wire

// A Command is something a client asks the server to do: place a structure,
// destroy one, or buy an upgrade. The server decodes the JSON, looks at Type,
// and applies the matching action to the world. Keep this in sync by hand with
// the client types in web/src/net/types.ts; the two languages cannot share a
// file.

// Command types: the "type" string the client sends.
const (
	CmdPlace   = "place"
	CmdDestroy = "destroy"
	CmdBuy     = "buy"  // purchase an upgrade; Upgrade says which
	CmdPing    = "ping" // a round-trip probe the server echoes back; see ws.go
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
	UpgradeGridSize      = "gridSize"
)

// Command targets a cell (X, Y) with an action (Type). For a "place", Kind says
// which structure to place and Dir says which way it faces. For a "buy",
// Upgrade says which upgrade to purchase.
type Command struct {
	Type    string `json:"type"`
	X       int    `json:"x"`
	Y       int    `json:"y"`
	Kind    string `json:"kind"`
	Dir     string `json:"dir"`
	Upgrade string `json:"upgrade"`
}
