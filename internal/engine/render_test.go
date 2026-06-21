package engine

import "testing"

func TestStringRendersGlyphs(t *testing.T) {
	w := NewWorld(5, 1)
	w.PlaceExtractor(0, 0, East, 3)
	w.PlaceBelt(1, 0, East)
	w.PlaceBelt(2, 0, East)
	w.PlaceBelt(3, 0, East)
	// (4,0) stays Empty.
	w.SetItem(2, 0, ItemOre) // an item is drawn on top of its belt

	if got, want := w.String(), "E>o>."; got != want {
		t.Errorf("render mismatch:\n got %q\nwant %q", got, want)
	}
}

func TestStringRendersRowsTopToBottom(t *testing.T) {
	w := NewWorld(2, 2)
	w.PlaceBelt(0, 0, East)          // top-left
	w.PlaceExtractor(1, 1, North, 5) // bottom-right
	if got, want := w.String(), ">.\n.E"; got != want {
		t.Errorf("render mismatch:\n got %q\nwant %q", got, want)
	}
}

func TestFactoryFlowGolden(t *testing.T) {
	w := NewWorld(5, 1)
	w.PlaceExtractor(0, 0, East, 2)
	w.PlaceBelt(1, 0, East)
	w.PlaceBelt(2, 0, East)
	w.PlaceBelt(3, 0, East)
	// (4,0) left Empty, so items back up at (3,0).

	frames := []string{
		"E>>>.", // initial
		"Eo>>.", // tick 1: extractor emits
		"E>o>.", // tick 2: item advances one tile
		"Eo>o.", // tick 3: advances; extractor emits again
		"E>oo.", // tick 4: lead item blocked at the end, the next catches up
		"Eooo.", // tick 5: belt filling
		"Eooo.", // tick 6: belt full
		"Eooo.", // tick 7: extractor blocked too, nothing created or lost
	}

	if got := w.String(); got != frames[0] {
		t.Fatalf("frame 0:\n got %q\nwant %q", got, frames[0])
	}
	for i := 1; i < len(frames); i++ {
		w.Step()
		if got := w.String(); got != frames[i] {
			t.Fatalf("frame %d:\n got %q\nwant %q", i, got, frames[i])
		}
	}

	if n := countItems(w); n != 3 {
		t.Errorf("backpressure must conserve items; want 3, got %d", n)
	}
}

func TestStepIsDeterministic(t *testing.T) {
	build := func() *World {
		w := NewWorld(5, 1)
		w.PlaceExtractor(0, 0, East, 2)
		for x := 1; x < 5; x++ {
			w.PlaceBelt(x, 0, East)
		}
		return w
	}

	a, b := build(), build()
	for i := 0; i < 50; i++ {
		a.Step()
		b.Step()
	}
	if a.String() != b.String() {
		t.Errorf("identical inputs diverged after 50 ticks:\nA: %q\nB: %q", a.String(), b.String())
	}
}
