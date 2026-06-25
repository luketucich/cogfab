// Package engine is the core of the Cogfab factory: a grid of tiles you place
// structures on.
//
// It only does game logic. It never touches the network, the screen, or the
// clock, so the same calls always produce the same grid. That makes it easy to
// test.
package engine

// Direction is which way a tile faces: North, East, South, or West.
// On the grid, x goes East and y goes South, starting from the top-left.
type Direction uint8

const (
	North Direction = iota
	East
	South
	West
)

// TileKind is what's on a tile: nothing, a belt, or an extractor.
type TileKind uint8

const (
	Empty TileKind = iota
	Belt
	Extractor
)

// Tile is one square of the grid: what's on it and the way it faces.
type Tile struct {
	Kind TileKind
	Dir  Direction
}

// World is the whole factory: a fixed-size grid of tiles.
//
// The tiles live in one flat list, row by row (index = y*width + x).
type World struct {
	width, height int
	tiles         []Tile
}

// NewWorld makes an empty grid of the given size.
func NewWorld(width, height int) *World {
	return &World{
		width:  width,
		height: height,
		tiles:  make([]Tile, width*height),
	}
}

// Width returns how many tiles wide the grid is.
func (w *World) Width() int { return w.width }

// Height returns how many tiles tall the grid is.
func (w *World) Height() int { return w.height }

// inBounds reports whether (x, y) is on the grid.
func (w *World) inBounds(x, y int) bool {
	return x >= 0 && x < w.width && y >= 0 && y < w.height
}

// index is the spot in the tiles list for (x, y), which must be on the grid.
func (w *World) index(x, y int) int { return y*w.width + x }

// At returns the tile at (x, y).
func (w *World) At(x, y int) Tile { return w.tiles[w.index(x, y)] }

// PlaceBelt puts a belt facing dir at (x, y). Off-grid coordinates are ignored.
func (w *World) PlaceBelt(x, y int, dir Direction) {
	if !w.inBounds(x, y) {
		return
	}
	w.tiles[w.index(x, y)] = Tile{Kind: Belt, Dir: dir}
}

// PlaceExtractor puts an extractor facing dir at (x, y). Off-grid coordinates
// are ignored.
func (w *World) PlaceExtractor(x, y int, dir Direction) {
	if !w.inBounds(x, y) {
		return
	}
	w.tiles[w.index(x, y)] = Tile{Kind: Extractor, Dir: dir}
}

// Destroy empties the tile at (x, y), removing any structure on it. Off-grid
// coordinates are ignored.
func (w *World) Destroy(x, y int) {
	if !w.inBounds(x, y) {
		return
	}
	w.tiles[w.index(x, y)] = Tile{}
}
