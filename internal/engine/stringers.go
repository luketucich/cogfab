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

// ParseDirection turns a direction name (as produced by Direction.String) back
// into a Direction. Unknown names fall back to North.
func ParseDirection(s string) Direction {
	switch s {
	case "east":
		return East
	case "south":
		return South
	case "west":
		return West
	default:
		return North
	}
}
