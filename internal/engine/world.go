// Package engine is the core of the Cogfab factory simulation: a grid of tiles
// that moves forward one step at a time when you call World.Step.
//
// It only does game logic. It never touches the network, the screen, or the
// clock, and nothing in it is random, so the same starting grid always gives
// the same result. That makes it easy to test: replay the steps and check the
// outcome.
package engine

// Direction is which way a tile points: North, East, South, or West.
// On the grid, x goes East and y goes South, starting from the top-left.
type Direction uint8

const (
	North Direction = iota
	East
	South
	West
)

// delta returns the (dx, dy) step for moving one tile in this direction.
func (d Direction) delta() (dx, dy int) {
	switch d {
	case North:
		return 0, -1
	case East:
		return 1, 0
	case South:
		return 0, 1
	case West:
		return -1, 0
	}
	return 0, 0
}

// TileKind is what's on a tile: nothing, a belt, or an extractor.
type TileKind uint8

const (
	Empty TileKind = iota
	Belt
	Extractor
)

// ItemKind is the item on a tile. ItemNone means the tile is empty.
type ItemKind uint8

const (
	ItemNone ItemKind = iota
	ItemOre
)

// Tile is one square of the grid. A belt or extractor can hold one item.
type Tile struct {
	Kind TileKind
	Dir  Direction
	Item ItemKind

	period   uint16 // extractor: how many ticks between drops
	cooldown uint16 // extractor: ticks left until the next drop
}

// World is the whole factory: a fixed-size grid of tiles.
//
// The tiles live in one flat list, always walked in the same order (not a map,
// whose order is random), so each step gives the same result every time.
type World struct {
	width, height int
	tiles         []Tile // one flat list, row by row: index = y*width + x
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

// PlaceBelt puts a belt facing dir at (x, y).
func (w *World) PlaceBelt(x, y int, dir Direction) {
	w.tiles[w.index(x, y)] = Tile{Kind: Belt, Dir: dir}
}

// PlaceExtractor puts an extractor at (x, y) that drops one ore every period
// ticks onto the tile in front of it. A period of 0 is treated as 1.
func (w *World) PlaceExtractor(x, y int, dir Direction, period uint16) {
	if period == 0 {
		period = 1
	}
	w.tiles[w.index(x, y)] = Tile{Kind: Extractor, Dir: dir, period: period}
}

// SetItem puts item on the tile at (x, y). Handy for setting up tests.
func (w *World) SetItem(x, y int, item ItemKind) {
	w.tiles[w.index(x, y)].Item = item
}
