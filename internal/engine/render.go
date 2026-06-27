package engine

import "strings"

// String draws the grid as text, one row per line, for tests and debugging.
// '.' is empty, '^>v<' is a belt facing the way it points, 'E' is an extractor,
// and 'S' is a seller.
func (w *World) String() string {
	var b strings.Builder
	b.Grow((w.width + 1) * w.height)
	for y := 0; y < w.height; y++ {
		if y > 0 {
			b.WriteByte('\n')
		}
		for x := 0; x < w.width; x++ {
			b.WriteByte(w.glyph(x, y))
		}
	}
	return b.String()
}

// glyph is the single character drawn for the tile at (x, y).
func (w *World) glyph(x, y int) byte {
	t := w.tiles[w.index(x, y)]
	switch t.Kind {
	case Belt:
		switch t.Dir {
		case North:
			return '^'
		case East:
			return '>'
		case South:
			return 'v'
		case West:
			return '<'
		}
	case Extractor:
		return 'E'
	case Seller:
		return 'S'
	}
	return '.'
}
