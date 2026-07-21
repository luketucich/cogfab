package server

import (
	"testing"

	"github.com/luketucich/cogfab/internal/engine"
)

// run sets up extractor -> n belts -> seller in a row and returns its hub.
func run(n int) (*engine.World, *Hub) {
	w := engine.NewWorld(n+3, 1)
	w.SetDeposit(0, 0, engine.Iron, 1_000_000)
	w.PlaceExtractor(0, 0, engine.East)
	for x := 1; x <= n; x++ {
		w.PlaceBelt(x, 0, engine.East)
	}
	w.PlaceSeller(n+1, 0, engine.West)
	w.SetPort(n+1, 0, true)
	return w, NewHub(w)
}

func tickN(h *Hub, n int) {
	for i := 0; i < n; i++ {
		h.tick()
	}
}

func TestMaterialSimCountsDeliveries(t *testing.T) {
	_, h := run(3)
	if h.credits != startingCredits {
		t.Fatalf("credits = %d before any tick, want the untouched starting credits %d", h.credits, startingCredits)
	}
	tickN(h, 10)
	if h.credits <= startingCredits {
		t.Fatalf("after 10s material should be landing: credits=%d", h.credits)
	}
	// The constants promise materialSpeed/materialGap = 5 chunks per second, mirrored by
	// the client's FlowItems. Pin both the advertised rate and the measured
	// deliveries so the two cannot silently drift.
	if h.currentRate() != 5 {
		t.Fatalf("currentRate = %v at steady state, want 5", h.currentRate())
	}
	before := h.credits
	tickN(h, 10)
	if got := h.credits - before; got != 50 {
		t.Fatalf("delivered %d over 10s at steady state, want 50 (5/s)", got)
	}
}

func TestMaterialSimDownstreamDrainsAfterBreak(t *testing.T) {
	w, h := run(4) // extractor -> belts 1..4 -> seller
	tickN(h, 10)   // fill the belt

	w.Destroy(1, 0) // break right after the extractor
	h.recompute()
	before := h.credits
	tickN(h, 5) // material already past the break keeps landing
	if h.credits <= before {
		t.Fatalf("credits did not grow after the break (%d -> %d); downstream material should still land", before, h.credits)
	}
	drained := h.credits
	tickN(h, 5) // ...then it stops once the belt has emptied
	if h.credits != drained {
		t.Errorf("credits kept growing after the drain finished (%d -> %d)", drained, h.credits)
	}
}

func TestMaterialSimRateScalesWithExtractorLevel(t *testing.T) {
	_, h := run(3)
	h.extractorLevel = maxSimLevel
	tickN(h, 10) // warm up
	before := h.credits
	tickN(h, 10)
	got := h.credits - before
	// materialSpeed/emitGap at the sim cap is 17.5/s; the emitter keeps the
	// remainder between steps, so ten seconds must land ~175, not saturate.
	if got < 170 || got > 180 {
		t.Fatalf("delivered %d over 10s at the sim cap, want ~175", got)
	}
}

func TestMaterialSimPaysTheTrueRatePastTheSimCap(t *testing.T) {
	// Way past the sim cap the belts cannot visibly carry more, so each chunk
	// batches several raw units. Ten seconds must pay ten seconds of the
	// advertised rate, within a chunk or two of timing slack.
	_, h := run(3)
	h.extractorLevel, h.beltLevel, h.valueLevel = 12, 12, 4
	tickN(h, 10) // warm up
	before := h.credits
	tickN(h, 10)
	got := float64(h.credits - before)
	want := h.currentRate() * 10
	if got < want*0.97 || got > want*1.03 {
		t.Fatalf("earned %v over 10s at deep levels, want ~%v (the advertised rate)", got, want)
	}
}

func TestMaterialSimBeltSpeedRaisesTheRate(t *testing.T) {
	_, h := run(3)
	h.beltLevel = 1 // 25% faster: same spacing arrives more often, 6.25/s
	tickN(h, 10)    // warm up
	before := h.credits
	tickN(h, 10)
	got := h.credits - before
	if got < 60 || got > 66 {
		t.Fatalf("delivered %d over 10s at belt level 1, want ~62 (6.25/s)", got)
	}
}

func TestMaterialSimSaleValueMultipliesEarnings(t *testing.T) {
	_, h := run(3)
	h.valueLevel = 1 // each delivery worth 2
	tickN(h, 10)     // warm up
	before := h.credits
	tickN(h, 10)
	got := h.credits - before
	if got != 100 {
		t.Fatalf("earned %d over 10s at value level 1, want 100 (5 chunks/s worth 2 each)", got)
	}
}

func TestMaterialSimHandlesTheBusiestVisuals(t *testing.T) {
	// The busiest the sim ever gets: ~39.4 chunks/s per line at the sim cap,
	// each worth 6. subSteps must keep up (one emission per step at most).
	_, h := run(3)
	h.extractorLevel = maxSimLevel
	h.beltLevel = maxSimLevel
	h.valueLevel = maxSimLevel
	tickN(h, 10) // warm up
	before := h.credits
	tickN(h, 10)
	got := h.credits - before
	if got < 2320 || got > 2400 {
		t.Fatalf("earned %d over 10s at the sim cap, want ~2360 (39.4/s worth 6)", got)
	}
}

func TestTwoExtractorsOnOneBeltAreTwoStreams(t *testing.T) {
	// Two extractors feed the same mouth belt from different sides. They are two
	// paying streams (two routes), exactly as the client draws them.
	w := engine.NewWorld(3, 3)
	w.SetDeposit(0, 1, engine.Iron, 1_000_000)
	w.SetDeposit(1, 0, engine.Iron, 1_000_000)
	w.SetPort(1, 2, true)
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
	w.SetDeposit(0, 1, engine.Iron, 1_000_000)
	w.SetDeposit(1, 0, engine.Iron, 1_000_000)
	w.SetPort(1, 2, true)
	w.PlaceExtractor(0, 1, engine.East)
	w.PlaceExtractor(1, 0, engine.South)
	w.PlaceBelt(1, 1, engine.South)
	w.PlaceSeller(1, 2, engine.North)
	h := NewHub(w)
	tickN(h, 5) // fill the belt
	before := h.credits
	tickN(h, 10)
	got := h.credits - before
	if got < 95 || got > 105 {
		t.Fatalf("two extractors delivered %d units in 10s, want ~100 (double one line)", got)
	}
}

func TestMaterialSimDropsWhenSellerRemoved(t *testing.T) {
	w, h := run(3)
	tickN(h, 8)
	w.Destroy(4, 0) // remove the seller (it sat one past the last belt)
	h.recompute()
	before := h.credits
	tickN(h, 8)
	if h.credits != before {
		t.Errorf("credits grew after the seller was removed (%d -> %d); material should fall off the end", before, h.credits)
	}
}

func TestDepositDepletesOnEmission(t *testing.T) {
	w := engine.NewWorld(3, 1)
	w.SetDeposit(0, 0, engine.Iron, 3)
	w.SetPort(2, 0, true)
	w.PlaceExtractor(0, 0, engine.East)
	w.PlaceBelt(1, 0, engine.East)
	w.PlaceSeller(2, 0, engine.West)
	h := NewHub(w)

	if changed := h.tick(); !changed {
		t.Fatal("an active extractor did not report changed resource stock")
	}
	if got := w.DepositAt(0, 0).Remaining; got != 0 {
		t.Fatalf("remaining stock = %d, want 0", got)
	}
	if h.currentRate() != 0 || len(h.routes) != 0 {
		t.Fatalf("depleted route remains active: rate=%v routes=%d", h.currentRate(), len(h.routes))
	}
	settled := h.credits
	tickN(h, 3)
	if h.credits != settled {
		t.Fatalf("depleted extractor kept earning: %d -> %d", settled, h.credits)
	}
}

func TestDisconnectedExtractorDoesNotConsumeItsDeposit(t *testing.T) {
	w := engine.NewWorld(2, 1)
	w.SetDeposit(0, 0, engine.Iron, 10)
	w.PlaceExtractor(0, 0, engine.East)
	h := NewHub(w)

	if changed := h.tick(); changed {
		t.Fatal("disconnected extractor changed resource stock")
	}
	if got := w.DepositAt(0, 0).Remaining; got != 10 {
		t.Fatalf("disconnected extractor left %d stock, want 10", got)
	}
}

func TestRawMaterialsHaveDistinctCreditRates(t *testing.T) {
	tests := []struct {
		kind engine.ResourceKind
		want float64
	}{
		{engine.Iron, 5},
		{engine.Copper, 15},
		{engine.Quartz, 40},
		{engine.Gold, 100},
	}
	for _, test := range tests {
		w, h := run(1)
		w.SetDeposit(0, 0, test.kind, 1_000_000)
		h.recompute()
		if got := h.currentRate(); got != test.want {
			t.Errorf("%s rate = %v credits/s, want %v", test.kind, got, test.want)
		}
	}
}

func TestCappedVisualChunksStillConsumeEveryRawUnit(t *testing.T) {
	const stock = 137
	w := engine.NewWorld(3, 1)
	w.SetDeposit(0, 0, engine.Copper, stock)
	w.SetPort(2, 0, true)
	w.PlaceExtractor(0, 0, engine.East)
	w.PlaceBelt(1, 0, engine.East)
	w.PlaceSeller(2, 0, engine.West)
	h := NewHub(w)
	h.extractorLevel = maxSimLevel + 7
	h.beltLevel = maxSimLevel + 7
	h.valueLevel = 2

	for i := 0; i < 20 && (len(h.routes) > 0 || len(h.chunks) > 0); i++ {
		h.tick()
	}
	if got := w.DepositAt(0, 0).Remaining; got != 0 {
		t.Fatalf("remaining stock = %d, want 0", got)
	}
	want := stock * rawValue(engine.Copper) * h.saleValueMultiplier()
	if got := h.credits - startingCredits; got != want {
		t.Fatalf("earned %d credits from %d copper, want %d", got, stock, want)
	}
}

func TestRefinerTriplesSaleValueAfterProcessing(t *testing.T) {
	w := engine.NewWorld(5, 1)
	w.SetDeposit(0, 0, engine.Iron, 1_000_000)
	w.PlaceExtractor(0, 0, engine.East)
	w.PlaceBelt(1, 0, engine.East)
	w.PlaceRefiner(2, 0, engine.West)
	w.PlaceBelt(3, 0, engine.East)
	w.PlaceSeller(4, 0, engine.West)
	w.SetPort(4, 0, true)
	h := NewHub(w)

	// Raw iron would be 5 credits/s; refined iron bars are 3× so 15 credits/s,
	// but the level-0 refiner only clears 0.5 jobs/s, so the HUD rate is 1.5.
	if got := h.currentRate(); got != 1.5 {
		t.Fatalf("refined rate = %v, want 1.5", got)
	}

	tickN(h, int(baseRefineTime)+5)
	before := h.credits
	tickN(h, 10)
	got := h.credits - before
	if got < 10 || got > 20 {
		t.Fatalf("delivered %d credits over 10s through a refiner, want about 15", got)
	}
}

func TestRefinerSpeedUpgradeShortensProcessTime(t *testing.T) {
	_, h := run(1)
	if got := h.refineTime(); got != baseRefineTime {
		t.Fatalf("level 0 refine time = %v, want %v", got, baseRefineTime)
	}
	h.refinerLevel = 2
	if got := h.refineTime(); got != baseRefineTime/refineMult(2) {
		t.Fatalf("level 2 refine time = %v, want %v", got, baseRefineTime/refineMult(2))
	}
}
