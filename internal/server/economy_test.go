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
	// The constants promise oreSpeed/oreGap = 5 chunks per second, mirrored by
	// the client's FlowItems. Pin both the advertised rate and the measured
	// deliveries so the two cannot silently drift.
	if h.currentRate() != 5 {
		t.Fatalf("currentRate = %v at steady state, want 5", h.currentRate())
	}
	before := h.ironOre
	tickN(h, 10)
	if got := h.ironOre - before; got != 50 {
		t.Fatalf("delivered %d over 10s at steady state, want 50 (5/s)", got)
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
	h.extractorLevel = maxSimLevel
	tickN(h, 10) // warm up
	before := h.ironOre
	tickN(h, 10)
	got := h.ironOre - before
	// oreSpeed/emitGap at the sim cap is 17.5/s; the emitter keeps the
	// remainder between steps, so ten seconds must land ~175, not saturate.
	if got < 170 || got > 180 {
		t.Fatalf("delivered %d over 10s at the sim cap, want ~175", got)
	}
}

func TestOreSimPaysTheTrueRatePastTheSimCap(t *testing.T) {
	// Way past the sim cap the belts cannot visibly carry more, so richer
	// chunks make up the difference. Ten seconds must pay ten seconds of the
	// advertised rate, within a chunk or two of timing slack.
	_, h := run(3)
	h.extractorLevel, h.beltLevel, h.valueLevel = 12, 12, 4
	tickN(h, 10) // warm up
	before := h.ironOre
	tickN(h, 10)
	got := float64(h.ironOre - before)
	want := h.currentRate() * 10
	if got < want*0.97 || got > want*1.03 {
		t.Fatalf("earned %v over 10s at deep levels, want ~%v (the advertised rate)", got, want)
	}
}

func TestOreSimBeltSpeedRaisesTheRate(t *testing.T) {
	_, h := run(3)
	h.beltLevel = 1 // 25% faster: same spacing arrives more often, 6.25/s
	tickN(h, 10)    // warm up
	before := h.ironOre
	tickN(h, 10)
	got := h.ironOre - before
	if got < 60 || got > 66 {
		t.Fatalf("delivered %d over 10s at belt level 1, want ~62 (6.25/s)", got)
	}
}

func TestOreSimOreValueMultipliesEarnings(t *testing.T) {
	_, h := run(3)
	h.valueLevel = 1 // each delivery worth 2
	tickN(h, 10)     // warm up
	before := h.ironOre
	tickN(h, 10)
	got := h.ironOre - before
	if got != 100 {
		t.Fatalf("earned %d over 10s at value level 1, want 100 (5 chunks/s worth 2 each)", got)
	}
}

func TestOreSimHandlesTheBusiestVisuals(t *testing.T) {
	// The busiest the sim ever gets: ~39.4 chunks/s per line at the sim cap,
	// each worth 6. subSteps must keep up (one emission per step at most).
	_, h := run(3)
	h.extractorLevel = maxSimLevel
	h.beltLevel = maxSimLevel
	h.valueLevel = maxSimLevel
	tickN(h, 10) // warm up
	before := h.ironOre
	tickN(h, 10)
	got := h.ironOre - before
	if got < 2320 || got > 2400 {
		t.Fatalf("earned %d over 10s at the sim cap, want ~2360 (39.4/s worth 6)", got)
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
