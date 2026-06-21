package engine

import "strings"

// String draws the grid as text, one row per line — handy for tests and
// debugging. '.' is empty, '^>v<' is a belt pointing the way it moves items,
// 'E' is an extractor, and 'o' is an ore.
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

// glyph is the single character drawn for the tile at (x, y). An item shows on
// top of the tile it sits on.
func (w *World) glyph(x, y int) byte {
	t := w.tiles[w.index(x, y)]
	if t.Item == ItemOre {
		return 'o'
	}
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
	}
	return '.'
}
