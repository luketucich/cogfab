package engine

import (
	"slices"
	"testing"
)

func assertProducerRoute(t *testing.T, w *World, wantPath []int, wantSeller int) {
	t.Helper()
	runs := w.Producers()
	if len(runs) != 1 {
		t.Fatalf("producers = %+v, want one route", runs)
	}
	if !slices.Equal(runs[0].Path, wantPath) {
		t.Fatalf("path = %v, want %v", runs[0].Path, wantPath)
	}
	if runs[0].Seller != wantSeller {
		t.Errorf("seller = %d, want %d", runs[0].Seller, wantSeller)
	}
}

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

	t.Run("path length counts the belts the material crosses", func(t *testing.T) {
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

	t.Run("the nearest seller wins across a branch", func(t *testing.T) {
		w := NewWorld(5, 5)
		w.PlaceExtractor(2, 4, North)
		w.PlaceBelt(2, 3, North)
		w.PlaceBelt(2, 2, North)
		w.PlaceBelt(2, 1, North)
		w.PlaceSeller(2, 0, South)
		w.PlaceBelt(3, 3, East)
		w.PlaceSeller(4, 3, West)

		want := []int{w.index(2, 3), w.index(3, 3)}
		assertProducerRoute(t, w, want, w.index(4, 3))
	})

	t.Run("equal routes keep north east south west order", func(t *testing.T) {
		w := NewWorld(5, 5)
		w.PlaceExtractor(2, 4, North)
		w.PlaceBelt(2, 3, North)
		w.PlaceBelt(2, 2, North)
		w.PlaceSeller(2, 1, South)
		w.PlaceBelt(3, 3, East)
		w.PlaceSeller(4, 3, West)

		want := []int{w.index(2, 3), w.index(2, 2)}
		assertProducerRoute(t, w, want, w.index(2, 1))
	})

	t.Run("a failed search does not affect the next extractor", func(t *testing.T) {
		w := NewWorld(8, 2)
		w.PlaceExtractor(0, 0, East)
		w.PlaceBelt(1, 0, East)
		w.PlaceBelt(2, 0, East)
		w.PlaceExtractor(4, 1, East)
		w.PlaceBelt(5, 1, East)
		w.PlaceBelt(6, 1, East)
		w.PlaceSeller(7, 1, West)

		want := []int{w.index(5, 1), w.index(6, 1)}
		assertProducerRoute(t, w, want, w.index(7, 1))
	})

	t.Run("a refiner in the line is part of the productive path", func(t *testing.T) {
		w := NewWorld(6, 1)
		w.PlaceExtractor(0, 0, East)
		w.PlaceBelt(1, 0, East)
		w.PlaceRefiner(2, 0, West) // input from west, output east
		w.PlaceBelt(3, 0, East)
		w.PlaceSeller(4, 0, West)
		want := []int{w.index(1, 0), w.index(2, 0), w.index(3, 0)}
		assertProducerRoute(t, w, want, w.index(4, 0))
	})

	t.Run("a refiner facing the wrong way does not complete the run", func(t *testing.T) {
		w := NewWorld(6, 1)
		w.PlaceExtractor(0, 0, East)
		w.PlaceBelt(1, 0, East)
		w.PlaceRefiner(2, 0, East) // faces away from the incoming belt
		w.PlaceBelt(3, 0, East)
		w.PlaceSeller(4, 0, West)
		if got := len(w.Producers()); got != 0 {
			t.Fatalf("got %d, want 0", got)
		}
	})
}
