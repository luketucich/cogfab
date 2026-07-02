package engine

import "testing"

func TestProducers(t *testing.T) {
	t.Run("extractor through belts to a seller is productive", func(t *testing.T) {
		w := NewWorld(6, 1)
		w.PlaceExtractor(0, 0, East)
		w.PlaceBelt(1, 0, East)
		w.PlaceBelt(2, 0, East)
		w.PlaceSeller(3, 0, West)
		if got := len(w.Producers()); got != 1 {
			t.Fatalf("got %d, want 1", got)
		}
	})

	t.Run("a run that reaches no seller is not productive", func(t *testing.T) {
		w := NewWorld(6, 1)
		w.PlaceExtractor(0, 0, East)
		w.PlaceBelt(1, 0, East)
		w.PlaceBelt(2, 0, East)
		if got := len(w.Producers()); got != 0 {
			t.Fatalf("got %d, want 0", got)
		}
	})

	t.Run("an extractor with no belts does not produce, even beside a seller", func(t *testing.T) {
		w := NewWorld(6, 1)
		w.PlaceExtractor(0, 0, East)
		w.PlaceSeller(1, 0, West)
		if got := len(w.Producers()); got != 0 {
			t.Fatalf("got %d, want 0", got)
		}
	})

	t.Run("two extractors feeding one run that sells both count", func(t *testing.T) {
		w := NewWorld(6, 3)
		w.PlaceExtractor(0, 0, East)
		w.PlaceExtractor(0, 2, East)
		w.PlaceBelt(1, 0, East)
		w.PlaceBelt(1, 1, South)
		w.PlaceBelt(1, 2, East)
		w.PlaceSeller(2, 1, West)
		if got := len(w.Producers()); got != 2 {
			t.Fatalf("got %d, want 2", got)
		}
	})

	t.Run("a belt at the extractor's side, not its mouth, does not feed it", func(t *testing.T) {
		// extractor faces south (mouth empty); the belt-and-seller sit to its east
		w := NewWorld(4, 2)
		w.PlaceExtractor(0, 0, South)
		w.PlaceBelt(1, 0, East)
		w.PlaceSeller(2, 0, West)
		if got := len(w.Producers()); got != 0 {
			t.Fatalf("got %d, want 0", got)
		}
	})

	t.Run("a seller fed on its side, not its mouth, does not complete the run", func(t *testing.T) {
		// the belt reaches the seller from the north, but the seller faces east
		w := NewWorld(4, 2)
		w.PlaceExtractor(0, 0, East)
		w.PlaceBelt(1, 0, East)
		w.PlaceBelt(2, 0, East)
		w.PlaceSeller(2, 1, East)
		if got := len(w.Producers()); got != 0 {
			t.Fatalf("got %d, want 0", got)
		}
	})

	t.Run("path length counts the belts the ore crosses", func(t *testing.T) {
		w := NewWorld(6, 1)
		w.PlaceExtractor(0, 0, East)
		w.PlaceBelt(1, 0, East)
		w.PlaceBelt(2, 0, East)
		w.PlaceBelt(3, 0, East)
		w.PlaceSeller(4, 0, West)
		runs := w.Producers()
		if len(runs) != 1 {
			t.Fatalf("got %d producers, want 1", len(runs))
		}
		if len(runs[0].Path) != 3 {
			t.Errorf("path = %d belts, want 3", len(runs[0].Path))
		}
	})
}
