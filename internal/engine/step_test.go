package engine

import "testing"

func TestItemAdvancesOneTilePerTick(t *testing.T) {
	w := NewWorld(4, 1)
	for x := 0; x < 4; x++ {
		w.PlaceBelt(x, 0, East)
	}
	w.SetItem(0, 0, ItemOre)

	w.Step()

	if got := w.At(1, 0).Item; got != ItemOre {
		t.Errorf("item should advance to (1,0) after one tick; got %v", got)
	}
	if got := w.At(0, 0).Item; got != ItemNone {
		t.Errorf("(0,0) should be empty after the item advances; got %v", got)
	}
}

func TestItemAdvancesExactlyOneTile(t *testing.T) {
	// Make sure it moves one tile, not all the way down the belt in a single tick.
	w := NewWorld(4, 1)
	for x := 0; x < 4; x++ {
		w.PlaceBelt(x, 0, East)
	}
	w.SetItem(0, 0, ItemOre)

	w.Step()

	if w.At(2, 0).Item == ItemOre || w.At(3, 0).Item == ItemOre {
		t.Error("item moved more than one tile in a single tick")
	}
}

func TestItemStopsAtEndOfBelt(t *testing.T) {
	w := NewWorld(4, 1)
	for x := 0; x < 4; x++ {
		w.PlaceBelt(x, 0, East)
	}
	w.SetItem(3, 0, ItemOre) // last belt; nothing downstream

	w.Step()

	if got := w.At(3, 0).Item; got != ItemOre {
		t.Errorf("item at the end of the belt should stay put; got %v", got)
	}
}

func TestItemDoesNotMoveOntoNonBelt(t *testing.T) {
	w := NewWorld(3, 1)
	w.PlaceBelt(0, 0, East)
	w.PlaceBelt(1, 0, East)
	// (2,0) stays Empty.
	w.SetItem(1, 0, ItemOre)

	w.Step()

	if got := w.At(1, 0).Item; got != ItemOre {
		t.Errorf("item should not move onto a non-belt tile; got %v at (1,0)", got)
	}
	if got := w.At(2, 0).Item; got != ItemNone {
		t.Errorf("a non-belt tile must not receive an item; got %v at (2,0)", got)
	}
}

func TestPackedItemsAreConservedAndDoNotMerge(t *testing.T) {
	// Front advances into the free tile; back is blocked this tick (the tile
	// ahead is still occupied). Nothing lost or duplicated.
	w := NewWorld(4, 1)
	for x := 0; x < 4; x++ {
		w.PlaceBelt(x, 0, East)
	}
	w.SetItem(1, 0, ItemOre)
	w.SetItem(2, 0, ItemOre)

	w.Step()

	if got := w.At(3, 0).Item; got != ItemOre {
		t.Errorf("front item should advance to (3,0); got %v", got)
	}
	if got := w.At(1, 0).Item; got != ItemOre {
		t.Errorf("back item should stay at (1,0) this tick; got %v", got)
	}
	if got := w.At(2, 0).Item; got != ItemNone {
		t.Errorf("(2,0) should be empty once the front advances; got %v", got)
	}
	if n := countItems(w); n != 2 {
		t.Errorf("items must be conserved; want 2, got %d", n)
	}
}

func TestExtractorEmitsOntoBeltInFront(t *testing.T) {
	w := NewWorld(2, 1)
	w.PlaceExtractor(0, 0, East, 1)
	w.PlaceBelt(1, 0, East)

	w.Step()

	if got := w.At(1, 0).Item; got != ItemOre {
		t.Errorf("extractor should emit ore onto the belt at (1,0); got %v", got)
	}
}

func TestExtractorEmitsEveryPeriodTicks(t *testing.T) {
	w := NewWorld(2, 1)
	w.PlaceExtractor(0, 0, East, 3)
	w.PlaceBelt(1, 0, East)

	// reports an emission, then clears the slot so the next one has room.
	emitted := func() bool {
		got := w.At(1, 0).Item == ItemOre
		w.SetItem(1, 0, ItemNone)
		return got
	}

	w.Step() // tick 1: emits (the extractor starts ready)
	if !emitted() {
		t.Fatal("tick 1: expected an emission")
	}
	w.Step() // tick 2: cooling down
	if emitted() {
		t.Fatal("tick 2: unexpected emission")
	}
	w.Step() // tick 3: cooling down
	if emitted() {
		t.Fatal("tick 3: unexpected emission")
	}
	w.Step() // tick 4: emits again, exactly 3 ticks after the first
	if !emitted() {
		t.Fatal("tick 4: expected an emission three ticks after the first")
	}
}

func TestExtractorDoesNotEmitWhenBeltIsFull(t *testing.T) {
	w := NewWorld(2, 1)
	w.PlaceExtractor(0, 0, East, 1)
	w.PlaceBelt(1, 0, East)
	w.SetItem(1, 0, ItemOre) // belt already occupied

	w.Step()

	if n := countItems(w); n != 1 {
		t.Errorf("a blocked extractor must not create or duplicate items; want 1, got %d", n)
	}
}

// countItems returns the number of occupied slots in the world.
func countItems(w *World) int {
	n := 0
	for y := 0; y < w.Height(); y++ {
		for x := 0; x < w.Width(); x++ {
			if w.At(x, y).Item != ItemNone {
				n++
			}
		}
	}
	return n
}
