package server

import (
	"testing"

	"github.com/luketucich/cogfab/internal/engine"
)

// run sets up extractor -> n belts -> seller in a row and returns its hub.
func run(n int) (*engine.World, *Hub) {
	w := engine.NewWorld(n+3, 1)
	w.PlaceExtractor(0, 0, engine.East)
	for x := 1; x <= n; x++ {
		w.PlaceBelt(x, 0, engine.East)
	}
	w.PlaceSeller(n+1, 0, engine.West)
	return w, NewHub(w)
}

func tickN(h *Hub, n int) {
	for i := 0; i < n; i++ {
		h.tick()
	}
}

func TestOreSimCountsDeliveries(t *testing.T) {
	_, h := run(3)
	if h.ironOre != startingOre {
		t.Fatalf("ironOre = %d before any tick, want the untouched starting ore %d", h.ironOre, startingOre)
	}
	tickN(h, 10)
	if h.ironOre <= startingOre {
		t.Fatalf("after 10s ore should be landing: ironOre=%d", h.ironOre)
	}
	// The constants promise oreSpeed/oreGap = 5 chunks per second at steady state,
	// mirrored by the client's FlowItems. Pin it so the two cannot silently drift.
	if h.ratePerSec != 5 {
		t.Fatalf("ratePerSec = %d at steady state, want 5", h.ratePerSec)
	}
}

func TestOreSimDownstreamDrainsAfterBreak(t *testing.T) {
	w, h := run(4) // extractor -> belts 1..4 -> seller
	tickN(h, 10)   // fill the belt

	w.Destroy(1, 0) // break right after the extractor
	h.recompute()
	before := h.ironOre
	tickN(h, 5) // the ore already past the break keeps landing
	if h.ironOre <= before {
		t.Fatalf("ironOre did not grow after the break (%d -> %d); downstream ore should still land", before, h.ironOre)
	}
	drained := h.ironOre
	tickN(h, 5) // ...then it stops once the belt has emptied
	if h.ironOre != drained {
		t.Errorf("ironOre kept growing after the drain finished (%d -> %d)", drained, h.ironOre)
	}
}

func TestOreSimRateScalesWithExtractorLevel(t *testing.T) {
	_, h := run(3)
	h.extractorLevel = maxExtractorLevel
	tickN(h, 10) // warm up
	before := h.ironOre
	tickN(h, 10)
	got := h.ironOre - before
	// oreSpeed/emitGap at max level is 17.5/s; the emitter keeps the remainder
	// between steps, so ten seconds must land ~175, not saturate below it.
	if got < 170 || got > 180 {
		t.Fatalf("delivered %d over 10s at max level, want ~175", got)
	}
}

func TestTwoExtractorsOnOneBeltAreTwoStreams(t *testing.T) {
	// Two extractors feed the same mouth belt from different sides. They are two
	// paying streams (two routes), exactly as the client draws them.
	w := engine.NewWorld(3, 3)
	w.PlaceExtractor(0, 1, engine.East)  // west of the belt
	w.PlaceExtractor(1, 0, engine.South) // north of the belt
	w.PlaceBelt(1, 1, engine.South)
	w.PlaceSeller(1, 2, engine.North)
	h := NewHub(w)
	if len(h.routes) != 2 {
		t.Fatalf("routes = %d, want 2 (one per extractor)", len(h.routes))
	}
}

func TestMoreExtractorsEarnMore(t *testing.T) {
	// Both streams above pour into one seller and both pay, so a second
	// extractor doubles the income.
	w := engine.NewWorld(3, 3)
	w.PlaceExtractor(0, 1, engine.East)
	w.PlaceExtractor(1, 0, engine.South)
	w.PlaceBelt(1, 1, engine.South)
	w.PlaceSeller(1, 2, engine.North)
	h := NewHub(w)
	tickN(h, 5) // fill the belt
	before := h.ironOre
	tickN(h, 10)
	got := h.ironOre - before
	if got < 95 || got > 105 {
		t.Fatalf("two extractors delivered %d ore in 10s, want ~100 (double one line)", got)
	}
}

func TestOreSimDropsWhenSellerRemoved(t *testing.T) {
	w, h := run(3)
	tickN(h, 8)
	w.Destroy(4, 0) // remove the seller (it sat one past the last belt)
	h.recompute()
	before := h.ironOre
	tickN(h, 8)
	if h.ironOre != before {
		t.Errorf("ironOre grew after the seller was removed (%d -> %d); ore should fall off the end", before, h.ironOre)
	}
}
