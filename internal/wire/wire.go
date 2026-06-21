// Package wire is the JSON message format sent from the server to clients.
//
// It is built on top of the engine using only the engine's public methods, so
// the engine itself stays free of any networking or encoding concerns.
package wire

import "github.com/luketucich/cogfab/internal/engine"

// StateMessage is a full snapshot of the factory grid for one tick. Tiles are
// in row-major order (index = y*width + x), matching the engine's layout.
type StateMessage struct {
	Type   string     `json:"type"`
	Tick   int        `json:"tick"`
	Width  int        `json:"width"`
	Height int        `json:"height"`
	Tiles  []TileView `json:"tiles"`
}

// TileView is one tile, with the enum values rendered as readable strings.
type TileView struct {
	Kind string `json:"kind"` // empty, belt, extractor
	Dir  string `json:"dir"`  // north, east, south, west
	Item string `json:"item"` // none, ore
}

// Snapshot builds a StateMessage describing the whole world at the given tick.
func Snapshot(w *engine.World, tick int) StateMessage {
	width, height := w.Width(), w.Height()
	tiles := make([]TileView, 0, width*height)
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			t := w.At(x, y)
			tiles = append(tiles, TileView{
				Kind: t.Kind.String(),
				Dir:  t.Dir.String(),
				Item: t.Item.String(),
			})
		}
	}
	return StateMessage{
		Type:   "state",
		Tick:   tick,
		Width:  width,
		Height: height,
		Tiles:  tiles,
	}
}
