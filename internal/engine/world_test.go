package engine

import "testing"

func TestDestroyEmptiesTile(t *testing.T) {
	w := NewWorld(2, 1)
	w.PlaceBelt(0, 0, East)

	w.Destroy(0, 0)

	if got := w.At(0, 0).Kind; got != Empty {
		t.Errorf("destroyed tile should be empty; got kind %v", got)
	}
}

func TestMutatorsIgnoreOffGridCoordinates(t *testing.T) {
	// Out-of-range coordinates must be a no-op, never a panic, so a malformed
	// command can't crash the server.
	w := NewWorld(2, 2)
	w.PlaceBelt(-1, 0, East)
	w.PlaceExtractor(5, 5, East)
	w.PlaceSeller(7, 7, East)
	w.Destroy(9, 9)

	for y := 0; y < w.Height(); y++ {
		for x := 0; x < w.Width(); x++ {
			if got := w.At(x, y).Kind; got != Empty {
				t.Errorf("off-grid writes must not touch the grid; (%d,%d) kind = %v", x, y, got)
			}
		}
	}
}

func TestPlaceSeller(t *testing.T) {
	w := NewWorld(2, 1)
	w.PlaceSeller(1, 0, West)

	tile := w.At(1, 0)
	if tile.Kind != Seller {
		t.Errorf("placed tile kind = %v, want Seller", tile.Kind)
	}
	if tile.Dir != West {
		t.Errorf("placed tile dir = %v, want West", tile.Dir)
	}
}
