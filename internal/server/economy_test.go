package server

import (
	"math"
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

func onlyRoute(t *testing.T, h *Hub) *route {
	t.Helper()
	if len(h.routes) != 1 {
		t.Fatalf("routes = %d, want exactly one", len(h.routes))
	}
	for _, rt := range h.routes {
		return rt
	}
	return nil
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

func TestCreditsSaturateInsteadOfWrappingNegative(t *testing.T) {
	_, h := run(1)
	h.credits = maxCredits - 1
	tickN(h, 3)

	if h.credits != maxCredits {
		t.Fatalf("credits = %d after earning near the integer limit, want %d", h.credits, maxCredits)
	}
	persisted := NewHub(NewResourceWorld("MAXCRED")).snapshot()
	persisted.Credits = h.credits
	if !persisted.valid() {
		t.Fatal("a saturated maximum balance should remain persistable")
	}
}

func TestFullWorldRefinersStayBoundedAtMaximumUpgrades(t *testing.T) {
	h := denseRefinerHub(resourceWorldSize, resourceWorldSize)
	h.extractorLevel = maxUpgradeLevel
	h.beltLevel = maxUpgradeLevel
	h.valueLevel = maxUpgradeLevel
	h.refinerLevel = maxUpgradeLevel
	tickN(h, 20)

	if len(h.routes) == 0 || h.credits <= startingCredits {
		t.Fatalf("max-level refiner world did not produce: routes=%d credits=%d", len(h.routes), h.credits)
	}
	if got, limit := len(h.chunks), len(h.routes)*4; got > limit {
		t.Fatalf("max-level refiner world retained %d chunks, want at most %d", got, limit)
	}
	if rate := h.currentRate(); rate <= 0 || math.IsNaN(rate) || math.IsInf(rate, 0) {
		t.Fatalf("max-level refiner rate is not finite and positive: %v", rate)
	}
	if views := h.refinerViews(); len(views) != len(h.routes) {
		t.Fatalf("refiner statuses=%d, want one for each of %d machines", len(views), len(h.routes))
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

func TestRefinerCapacityDoesNotGrowWithVisualBatching(t *testing.T) {
	w, h := run(3)
	w.PlaceRefiner(2, 0, engine.East)
	h.recompute()
	h.extractorLevel, h.beltLevel = 12, 12

	// Deep production upgrades batch several physical units into each visible
	// chunk. The batch must take proportionally longer to refine, or those
	// unrelated upgrades would silently make a level-zero refiner faster.
	if got := h.currentRate(); got != 7.5 {
		t.Fatalf("deep-level refiner rate = %v, want the level-zero capacity of 7.5 credits/s", got)
	}
	tickN(h, 20)
	before := h.credits
	tickN(h, 200)
	got, want := float64(h.credits-before), h.currentRate()*200
	if got < want*0.99 || got > want*1.01 {
		t.Fatalf("deep-level refiner earned %v over 200s, want ~%v", got, want)
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

func TestBaseRefinerRaisesCashflowAfterProcessing(t *testing.T) {
	w := engine.NewWorld(5, 1)
	w.SetDeposit(0, 0, engine.Iron, 1_000_000)
	w.PlaceExtractor(0, 0, engine.East)
	w.PlaceBelt(1, 0, engine.East)
	w.PlaceRefiner(2, 0, engine.West)
	w.PlaceBelt(3, 0, engine.East)
	w.PlaceSeller(4, 0, engine.West)
	w.SetPort(4, 0, true)
	h := NewHub(w)

	// Raw iron earns 5 credits/s. A level-0 refiner clears 2.5 jobs/s,
	// each worth 3, so adding one raises cash flow by 50% instead of becoming
	// an early-game bottleneck.
	if got := h.currentRate(); got != 7.5 {
		t.Fatalf("refined rate = %v, want 7.5", got)
	}

	tickN(h, 6)
	before := h.credits
	tickN(h, 10)
	got := h.credits - before
	if got < 70 || got > 80 {
		t.Fatalf("delivered %d credits over 10s through a refiner, want about 75", got)
	}
}

func TestRefinerBackpressureBoundsTheQueueAndPreservesTheDeposit(t *testing.T) {
	const stock = 1_000_000
	w := engine.NewWorld(5, 1)
	w.SetDeposit(0, 0, engine.Iron, stock)
	w.PlaceExtractor(0, 0, engine.East)
	w.PlaceBelt(1, 0, engine.East)
	w.PlaceRefiner(2, 0, engine.East)
	w.PlaceBelt(3, 0, engine.East)
	w.PlaceSeller(4, 0, engine.West)
	w.SetPort(4, 0, true)
	h := NewHub(w)

	tickN(h, 100)
	consumed := stock - w.DepositAt(0, 0).Remaining
	if consumed < 245 || consumed > 260 {
		t.Fatalf("base refiner consumed %d ore in 100s, want about 250 with backpressure", consumed)
	}
	if got := len(h.chunks); got > 12 {
		t.Fatalf("base refiner retained %d chunks, want a bounded physical queue", got)
	}
	views := h.refinerViews()
	if len(views) != 1 || views[0].Queued == 0 || views[0].Queued > 4 {
		t.Fatalf("refiner queue = %+v, want one to four actually waiting chunks", views)
	}
}

func TestRefinerSpeedUpgradeShortensProcessTime(t *testing.T) {
	_, h := run(1)
	for _, test := range []struct {
		level int
		want  float64
	}{
		{0, 0.4},
		{1, 0.4 / 1.5},
		{2, 0.2},
	} {
		h.refinerLevel = test.level
		if got := h.refineTime(); got != test.want {
			t.Errorf("level %d refine time = %v, want %v", test.level, got, test.want)
		}
	}
}

func TestRefinerSpeedFillsAStandardLineInUsefulSteps(t *testing.T) {
	w, h := run(3)
	w.PlaceRefiner(2, 0, engine.East)
	h.recompute()

	for _, test := range []struct {
		level int
		want  float64
	}{
		{0, 7.5},   // half of the ore becomes a 3-credit bar
		{1, 11.25}, // three quarters of the line is refined
		{2, 15},    // the full 5 ore/s line is refined
	} {
		h.refinerLevel = test.level
		if got := h.currentRate(); got != test.want {
			t.Errorf("level %d refined rate = %v, want %v", test.level, got, test.want)
		}
	}
}

func TestFractionalRefinerCycleMatchesAdvertisedRate(t *testing.T) {
	w, h := run(3)
	w.PlaceRefiner(2, 0, engine.East)
	h.recompute()
	h.refinerLevel = 1 // 0.4 / 1.5 seconds does not divide a 25 ms sub-step

	tickN(h, 10)
	before := h.credits
	tickN(h, 100)
	if got, want := h.credits-before, int(h.currentRate()*100); got != want {
		t.Fatalf("level-1 refiner earned %d credits over 100 seconds, want %d", got, want)
	}
}

func TestRefinerPreservesTripleLifetimeValue(t *testing.T) {
	const stock = 13
	w := engine.NewWorld(5, 1)
	w.SetDeposit(0, 0, engine.Copper, stock)
	w.PlaceExtractor(0, 0, engine.East)
	w.PlaceBelt(1, 0, engine.East)
	w.PlaceRefiner(2, 0, engine.East)
	w.PlaceBelt(3, 0, engine.East)
	w.PlaceSeller(4, 0, engine.West)
	w.SetPort(4, 0, true)
	h := NewHub(w)

	for i := 0; i < 60 && (len(h.routes) > 0 || len(h.chunks) > 0); i++ {
		h.tick()
	}
	if len(h.routes) > 0 || len(h.chunks) > 0 {
		t.Fatalf("refined line did not drain: routes=%d chunks=%d", len(h.routes), len(h.chunks))
	}
	if got, want := h.credits-startingCredits, stock*rawValue(engine.CopperSheet); got != want {
		t.Fatalf("earned %d credits from %d copper, want %d (triple lifetime value)", got, stock, want)
	}
}

func TestDeepLevelRefinerPreservesEveryBatchedUnit(t *testing.T) {
	const stock = 137
	w := engine.NewWorld(5, 1)
	w.SetDeposit(0, 0, engine.Copper, stock)
	w.PlaceExtractor(0, 0, engine.East)
	w.PlaceBelt(1, 0, engine.East)
	w.PlaceRefiner(2, 0, engine.East)
	w.PlaceBelt(3, 0, engine.East)
	w.PlaceSeller(4, 0, engine.West)
	w.SetPort(4, 0, true)
	h := NewHub(w)
	h.extractorLevel, h.beltLevel = 12, 12

	for i := 0; i < 100 && (len(h.routes) > 0 || len(h.chunks) > 0); i++ {
		h.tick()
	}
	if len(h.routes) > 0 || len(h.chunks) > 0 {
		t.Fatalf("deep refined line did not drain: routes=%d chunks=%d", len(h.routes), len(h.chunks))
	}
	if got, want := h.credits-startingCredits, stock*rawValue(engine.CopperSheet); got != want {
		t.Fatalf("earned %d credits from %d batched copper, want %d", got, stock, want)
	}
}

func TestRefinerViewsReportActiveQueueAndIdleMachines(t *testing.T) {
	w := engine.NewWorld(4, 1)
	w.PlaceRefiner(1, 0, engine.West)
	w.PlaceRefiner(3, 0, engine.West)
	h := NewHub(w)
	rt := &route{cells: []int{1}, refiner: 1, refines: true}
	active := &chunk{route: rt, dist: 0, units: 1, resource: engine.Copper, processLeft: 0.3}
	h.chunks = []*chunk{
		active,
		{route: rt, dist: 0, units: 1, resource: engine.Copper, waiting: true},
		{route: rt, dist: 0, units: 1, resource: engine.Iron, waiting: true},
	}
	h.refinerBusy[1] = active

	views := h.refinerViews()
	if len(views) != 2 {
		t.Fatalf("refiner views = %d, want 2", len(views))
	}
	if got := views[0]; got.X != 1 || got.Y != 0 || got.Resource != "copper" || got.Remaining != 0.3 || got.Duration != baseRefineTime || got.Queued != 2 {
		t.Fatalf("active refiner = %+v, want copper with 0.3s left and 2 queued", got)
	}
	if got := views[1]; got.X != 3 || got.Y != 0 || got.Resource != "" || got.Remaining != 0 || got.Duration != baseRefineTime || got.Queued != 0 {
		t.Fatalf("idle refiner = %+v, want an empty queue", got)
	}
}

func TestRefinerViewsSeparateMovingOreFromARealQueue(t *testing.T) {
	w := engine.NewWorld(4, 1)
	w.PlaceRefiner(2, 0, engine.East)
	h := NewHub(w)
	rt := &route{cells: []int{0, 1, 2}, refiner: 2, refinerAt: 2, refines: true}
	h.chunks = []*chunk{
		{route: rt, dist: 1.5, units: 1, resource: engine.Iron},
		{route: rt, dist: 1, units: 1, resource: engine.Iron, waiting: true},
	}

	views := h.refinerViews()
	if len(views) != 1 {
		t.Fatalf("refiner views = %d, want 1", len(views))
	}
	if got := views[0]; got.Queued != 1 || got.Incoming != 1 {
		t.Fatalf("refiner inventory = %+v, want one waiting and one incoming", got)
	}
}

func TestRefinerViewUsesArrivalLimitedOutputCadence(t *testing.T) {
	w, h := run(3)
	w.PlaceRefiner(2, 0, engine.East)
	h.recompute()
	h.refinerLevel = 5
	tickN(h, 5)

	views := h.refinerViews()
	if len(views) != 1 {
		t.Fatalf("refiner views = %d, want 1", len(views))
	}
	if got := views[0].Duration; got != 0.2 {
		t.Fatalf("output interval = %v, want 0.2s from the untouched belt line", got)
	}
}

func TestBusyOrQueuedFastRefinerUsesItsProcessDuration(t *testing.T) {
	w := engine.NewWorld(3, 1)
	w.PlaceRefiner(1, 0, engine.East)
	h := NewHub(w)
	h.refinerLevel = 5
	rt := &route{cells: []int{1}, refiner: 1, refines: true}
	active := &chunk{route: rt, units: 1, resource: engine.Iron, processLeft: 0.05}
	h.routes = map[string]*route{"active": rt}
	h.chunks = []*chunk{
		active,
		{route: rt, units: 1, resource: engine.Iron, waiting: true},
	}
	h.refinerBusy[1] = active

	views := h.refinerViews()
	if len(views) != 1 {
		t.Fatalf("refiner views = %d, want 1", len(views))
	}
	if got, want := views[0].Duration, h.refineTime(); got != want {
		t.Fatalf("busy output duration = %v, want process duration %v", got, want)
	}
}

func TestRefinerViewIgnoresRawOreAlreadyDownstreamWhenPlaced(t *testing.T) {
	w := engine.NewWorld(3, 1)
	w.PlaceRefiner(1, 0, engine.East)
	h := NewHub(w)
	rt := &route{cells: []int{0, 1, 2}, refiner: 1, refinerAt: 1, refines: true}
	h.routes = map[string]*route{"replacement": rt}
	h.chunks = []*chunk{
		{route: rt, dist: 2.2, units: 1, resource: engine.Iron},
		{route: rt, dist: 0.5, units: 1, resource: engine.Iron},
	}

	views := h.refinerViews()
	if len(views) != 1 {
		t.Fatalf("refiner views = %d, want 1", len(views))
	}
	if got := views[0]; got.Incoming != 1 || got.Queued != 0 || got.NextOutput < 0.599 || got.NextOutput > 0.601 {
		t.Fatalf("replacement refiner = %+v, want only upstream ore with a 0.6s ETA", got)
	}
}

func TestRemovedRefinerJobReacquiresTheNextMachine(t *testing.T) {
	w := engine.NewWorld(7, 1)
	w.SetDeposit(0, 0, engine.Iron, 100)
	w.PlaceExtractor(0, 0, engine.East)
	w.PlaceBelt(1, 0, engine.East)
	w.PlaceRefiner(2, 0, engine.East)
	w.PlaceBelt(3, 0, engine.East)
	w.PlaceRefiner(4, 0, engine.East)
	w.PlaceBelt(5, 0, engine.East)
	w.PlaceSeller(6, 0, engine.West)
	w.SetPort(6, 0, true)
	h := NewHub(w)
	rt := onlyRoute(t, h)
	owner := &chunk{
		route: rt, dist: float64(rt.refinerAt) + h.emitGap(), units: 1,
		resource: engine.Iron, processLeft: 0.2,
	}
	h.chunks = []*chunk{owner}
	h.refinerBusy[rt.refiner] = owner

	w.PlaceBelt(2, 0, engine.East)
	h.recompute()
	if owner.processLeft != 0 || len(h.refinerBusy) != 0 {
		t.Fatalf("removed refiner left process=%v busy=%d, want a clean job", owner.processLeft, len(h.refinerBusy))
	}
	rt = onlyRoute(t, h)
	owner.dist = float64(rt.refinerAt)
	h.advanceChunk(owner, h.beltSpeed(), 1.0/subSteps, make(map[int]float64))
	if h.refinerBusy[rt.refiner] != owner || owner.processLeft >= h.refineTime() {
		t.Fatalf("next refiner did not acquire a fresh job: process=%v busy=%v", owner.processLeft, h.refinerBusy[rt.refiner] == owner)
	}
}

func TestInactiveDrainingRouteRefreshesRefinerMetadata(t *testing.T) {
	w, h := run(3)
	rt := onlyRoute(t, h)
	h.chunks = []*chunk{{route: rt, dist: 0.5, units: 1, resource: engine.Iron}}
	w.Consume(0, 0, w.DepositAt(0, 0).Remaining)
	w.PlaceRefiner(2, 0, engine.East)

	h.recompute()
	if len(h.routes) != 0 || !rt.refines || rt.refiner != 2 || rt.refinerAt != 1 {
		t.Fatalf("inactive route metadata = routes=%d refines=%v cell=%d at=%d", len(h.routes), rt.refines, rt.refiner, rt.refinerAt)
	}
	tickN(h, 3)
	if len(h.chunks) != 0 || h.credits-startingCredits != rawValue(engine.IronBar) {
		t.Fatalf("draining ore was not refined after the source stopped: chunks=%d earned=%d", len(h.chunks), h.credits-startingCredits)
	}
}

func TestFastRefinerReportsMovingOreWithoutAFalseQueue(t *testing.T) {
	w, h := run(12)
	w.PlaceRefiner(11, 0, engine.East)
	h.recompute()
	h.refinerLevel = 3

	h.tick()
	warming := h.refinerViews()
	if len(warming) != 1 || warming[0].NextOutput < 3 {
		t.Fatalf("warm-up ETA = %+v, want the distant ore's multi-second travel time", warming)
	}

	tickN(h, 20)
	views := h.refinerViews()
	if len(views) != 1 {
		t.Fatalf("refiner views = %d, want 1", len(views))
	}
	if got := views[0]; got.Queued != 0 || got.Incoming == 0 || got.NextOutput <= 0 {
		t.Fatalf("fast refiner inventory = %+v, want moving inbound ore, a truthful ETA, and no waiting queue", got)
	}
}

func TestSharedRefinerRateUsesOneMachineCapacity(t *testing.T) {
	w := engine.NewWorld(6, 3)
	for _, y := range []int{0, 2} {
		w.SetDeposit(0, y, engine.Iron, 1_000_000)
		w.PlaceExtractor(0, y, engine.East)
		w.PlaceBelt(1, y, engine.East)
		w.PlaceBelt(2, y, engine.East)
	}
	w.PlaceBelt(2, 1, engine.East)
	w.PlaceRefiner(3, 1, engine.West)
	w.PlaceBelt(4, 1, engine.East)
	w.PlaceSeller(5, 1, engine.West)
	w.SetPort(5, 1, true)
	h := NewHub(w)

	if got := len(h.routes); got != 2 {
		t.Fatalf("routes = %d, want 2", got)
	}
	if got := h.currentRate(); got != 7.5 {
		t.Fatalf("shared-refiner rate = %v, want 7.5", got)
	}
	tickN(h, 20)
	before := h.credits
	tickN(h, 100)
	if got, want := h.credits-before, int(h.currentRate()*100); got != want {
		t.Fatalf("shared refiner earned %d credits over 100 seconds, want %d", got, want)
	}
}
