package wire

// A Command is something a client asks the server to do: place a structure,
// destroy one, and more later. The server decodes the JSON, looks at Type, and
// applies the matching action to the world. Keep this in sync by hand with the
// client types in web/src/net/types.ts; the two languages cannot share a file.

// Command types: the "type" string the client sends.
const (
	CmdPlace   = "place"
	CmdDestroy = "destroy"
)

// Place kinds: the "kind" a place command carries. Mirrors the placeable tile
// kinds in the engine.
const (
	KindBelt      = "belt"
	KindExtractor = "extractor"
)

// Command targets a cell (X, Y) with an action (Type). Kind says which item to
// place and is only set for "place". Add fields like direction as needed.
type Command struct {
	Type string `json:"type"`
	X    int    `json:"x"`
	Y    int    `json:"y"`
	Kind string `json:"kind"`
}
