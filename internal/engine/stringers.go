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
	case Seller:
		return "seller"
	case Refiner:
		return "refiner"
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

// String returns the lowercase material name used on the wire.
func (r ResourceKind) String() string {
	switch r {
	case Iron:
		return "iron"
	case Copper:
		return "copper"
	case Quartz:
		return "quartz"
	case Gold:
		return "gold"
	case IronBar:
		return "ironBar"
	case CopperSheet:
		return "copperSheet"
	case QuartzCrystal:
		return "quartzCrystal"
	case GoldIngot:
		return "goldIngot"
	default:
		return "none"
	}
}
