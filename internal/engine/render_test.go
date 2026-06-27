package engine

import "testing"

func TestStringRendersGlyphs(t *testing.T) {
	w := NewWorld(6, 1)
	w.PlaceExtractor(0, 0, East)
	w.PlaceBelt(1, 0, East)
	w.PlaceBelt(2, 0, East)
	w.PlaceBelt(3, 0, East)
	w.PlaceSeller(4, 0, East)
	// (5,0) stays Empty.

	if got, want := w.String(), "E>>>S."; got != want {
		t.Errorf("render mismatch:\n got %q\nwant %q", got, want)
	}
}

func TestStringRendersRowsTopToBottom(t *testing.T) {
	w := NewWorld(2, 2)
	w.PlaceBelt(0, 0, East)       // top-left
	w.PlaceExtractor(1, 1, North) // bottom-right
	if got, want := w.String(), ">.\n.E"; got != want {
		t.Errorf("render mismatch:\n got %q\nwant %q", got, want)
	}
}
