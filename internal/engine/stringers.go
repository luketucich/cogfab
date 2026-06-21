package engine

// String returns the lowercase name of the direction (e.g. "east").
func (d Direction) String() string {
	switch d {
	case North:
		return "north"
	case East:
		return "east"
	case South:
		return "south"
	case West:
		return "west"
	}
	return "unknown"
}

// String returns the lowercase name of the tile kind (e.g. "belt").
func (k TileKind) String() string {
	switch k {
	case Empty:
		return "empty"
	case Belt:
		return "belt"
	case Extractor:
		return "extractor"
	}
	return "unknown"
}

// String returns the lowercase name of the item (e.g. "ore"); "none" when empty.
func (i ItemKind) String() string {
	switch i {
	case ItemNone:
		return "none"
	case ItemOre:
		return "ore"
	}
	return "unknown"
}
