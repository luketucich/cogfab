package server

import (
	"testing"

	"github.com/luketucich/cogfab/internal/engine"
	"github.com/luketucich/cogfab/internal/wire"
)

// shopHub is a hub on an empty 12x8 world (the real game size), so the starting
// unlocked region sits at x 4-6, y 2-4.
func shopHub() *Hub {
	return NewHub(engine.NewWorld(12, 8))
}

// lineHub is a hub with a working extractor-belt-seller line already earning,
// since upgrades only sell while ore is flowing.
func lineHub() *Hub {
	h := shopHub()
	h.world.PlaceExtractor(4, 3, engine.East)
	h.world.PlaceBelt(5, 3, engine.East)
	h.world.PlaceSeller(6, 3, engine.West)
	h.recompute()
	return h
}

func place(kind string, x, y int) wire.Command {
	return wire.Command{Type: wire.CmdPlace, X: x, Y: y, Kind: kind, Dir: "east"}
}

// applyAndSettle runs a command the way Run does: apply, then recompute the
// routes when it changed anything.
func applyAndSettle(h *Hub, cmd wire.Command) bool {
	changed := h.apply(cmd)
	if changed {
		h.recompute()
	}
	return changed
}

func TestPlacingChargesAndDestroyingRefundsHalf(t *testing.T) {
	// The existing line keeps the world earning while we build and tear down a
	// lone extractor, so the destroy refunds half (a destroy that leaves
	// nothing earning refunds in full instead).
	h := lineHub()
	cost := buildCost[engine.Extractor]
	before := h.ironOre

	if !h.apply(place(wire.KindExtractor, 4, 2)) {
		t.Fatal("placing an extractor on an unlocked empty cell should succeed")
	}
	if h.ironOre != before-cost {
		t.Fatalf("ironOre = %d after buying an extractor, want %d", h.ironOre, before-cost)
	}

	if !h.apply(wire.Command{Type: wire.CmdDestroy, X: 4, Y: 2}) {
		t.Fatal("destroying a structure should succeed")
	}
	if want := before - cost + cost/2; h.ironOre != want {
		t.Fatalf("ironOre = %d after the refund, want %d (half back)", h.ironOre, want)
	}
	if h.world.At(4, 2).Kind != engine.Empty {
		t.Error("the cell should be empty after the destroy")
	}
}

func TestDestroyingTheLastLineRefundsInFull(t *testing.T) {
	h := lineHub()
	before := h.ironOre

	// Tearing the extractor off the only working line leaves nothing earning,
	// so the full 75 comes back, not 37.
	if !applyAndSettle(h, wire.Command{Type: wire.CmdDestroy, X: 4, Y: 3}) {
		t.Fatal("destroying the extractor should succeed")
	}
	if h.ironOre != before+buildCost[engine.Extractor] {
		t.Fatalf("ironOre = %d, want %d (full refund when nothing earns)", h.ironOre, before+buildCost[engine.Extractor])
	}
}

func TestTheGameCanAlwaysAffordALine(t *testing.T) {
	// Burn ore the worst way we know: build a line, then tear it down starting
	// with a piece that leaves the rest still earning, over and over. The purse
	// plus a full liquidation must always cover a fresh 160-ore line.
	h := shopHub()
	lineCost := buildCost[engine.Extractor] + buildCost[engine.Belt] + buildCost[engine.Seller]
	for i := 0; i < 5; i++ {
		applyAndSettle(h, place(wire.KindExtractor, 4, 3))
		applyAndSettle(h, wire.Command{Type: wire.CmdPlace, X: 5, Y: 3, Kind: wire.KindBelt, Dir: "east"})
		applyAndSettle(h, wire.Command{Type: wire.CmdPlace, X: 6, Y: 3, Kind: wire.KindSeller, Dir: "west"})
		applyAndSettle(h, wire.Command{Type: wire.CmdDestroy, X: 4, Y: 3})
		applyAndSettle(h, wire.Command{Type: wire.CmdDestroy, X: 5, Y: 3})
		applyAndSettle(h, wire.Command{Type: wire.CmdDestroy, X: 6, Y: 3})
	}
	if h.ironOre < lineCost {
		t.Fatalf("ironOre = %d after churn, want at least %d so a line is still buildable", h.ironOre, lineCost)
	}
}

func TestPlacingIsRejectedWhenBroke(t *testing.T) {
	h := shopHub()
	h.ironOre = 5 // less than any structure

	if h.apply(place(wire.KindBelt, 4, 2)) {
		t.Fatal("placing should be rejected when the ore does not cover it")
	}
	if h.ironOre != 5 || h.world.At(4, 2).Kind != engine.Empty {
		t.Errorf("a rejected place must change nothing: ore=%d kind=%v", h.ironOre, h.world.At(4, 2).Kind)
	}
}

func TestPlacingIsRejectedOutsideTheUnlockedRegion(t *testing.T) {
	h := shopHub()

	if h.apply(place(wire.KindBelt, 0, 0)) {
		t.Fatal("placing outside the unlocked region should be rejected")
	}
	if h.ironOre != startingOre {
		t.Errorf("ironOre = %d, want the untouched %d", h.ironOre, startingOre)
	}
}

func TestPlacingCannotOverwrite(t *testing.T) {
	h := shopHub()
	h.apply(place(wire.KindBelt, 4, 2))
	before := h.ironOre

	if h.apply(place(wire.KindExtractor, 4, 2)) {
		t.Fatal("placing on an occupied cell should be rejected")
	}
	if h.world.At(4, 2).Kind != engine.Belt || h.ironOre != before {
		t.Errorf("the belt and the ore should be untouched: kind=%v ore=%d", h.world.At(4, 2).Kind, h.ironOre)
	}
}

func TestDestroyingNothingGivesNothing(t *testing.T) {
	h := shopHub()

	if h.apply(wire.Command{Type: wire.CmdDestroy, X: 4, Y: 2}) {
		t.Fatal("destroying an empty cell should be a rejected no-op")
	}
	if h.ironOre != startingOre {
		t.Errorf("ironOre = %d, want the untouched %d", h.ironOre, startingOre)
	}
}

func TestRotatingIsFreeAndGuarded(t *testing.T) {
	h := shopHub()
	h.apply(place(wire.KindExtractor, 4, 2))
	before := h.ironOre

	if !h.apply(wire.Command{Type: wire.CmdRotate, X: 4, Y: 2}) {
		t.Fatal("rotating a structure should succeed")
	}
	if got := h.world.At(4, 2).Dir; got != engine.South {
		t.Errorf("dir = %v after rotating an east extractor, want south", got)
	}
	if h.ironOre != before {
		t.Errorf("ironOre = %d after a rotate, want the untouched %d (rotating is free)", h.ironOre, before)
	}

	if h.apply(wire.Command{Type: wire.CmdRotate, X: 5, Y: 2}) {
		t.Error("rotating an empty cell should be a rejected no-op")
	}
	if h.apply(wire.Command{Type: wire.CmdRotate, X: 0, Y: 0}) {
		t.Error("rotating outside the unlocked region should be rejected")
	}
}

func TestBuyingNeedsIncome(t *testing.T) {
	h := shopHub() // empty world: nothing earning
	h.ironOre = 1 << 30

	if h.apply(wire.Command{Type: wire.CmdBuy, Upgrade: wire.UpgradeExtractorRate}) {
		t.Fatal("upgrades should not sell while nothing is earning")
	}
	if h.apply(wire.Command{Type: wire.CmdBuy, Upgrade: wire.UpgradeGridSize}) {
		t.Fatal("upgrades should not sell while nothing is earning")
	}
}

func TestBuyingExtractorRate(t *testing.T) {
	h := lineHub()
	buy := wire.Command{Type: wire.CmdBuy, Upgrade: wire.UpgradeExtractorRate}

	h.ironOre = extractorBaseCost
	if !h.apply(buy) {
		t.Fatal("the first extractor level should be buyable at exact cost")
	}
	if h.extractorLevel != 1 || h.ironOre != 0 {
		t.Fatalf("level=%d ore=%d after buying, want level 1 and 0", h.extractorLevel, h.ironOre)
	}
	if h.emitGap() >= oreGap {
		t.Error("a higher level should emit ore closer together")
	}

	h.ironOre = 0
	if h.apply(buy) {
		t.Fatal("buying should be rejected when broke")
	}

	h.ironOre = 1 << 30
	h.extractorLevel = maxExtractorLevel
	if h.apply(buy) {
		t.Fatal("buying past the max level should be rejected")
	}
}

func TestBuyingBeltSpeedAndOreValue(t *testing.T) {
	h := lineHub()

	h.ironOre = beltBaseCost
	if !h.apply(wire.Command{Type: wire.CmdBuy, Upgrade: wire.UpgradeBeltSpeed}) {
		t.Fatal("the first belt level should be buyable at exact cost")
	}
	if h.beltLevel != 1 || h.ironOre != 0 {
		t.Fatalf("beltLevel=%d ore=%d after buying, want level 1 and 0", h.beltLevel, h.ironOre)
	}
	if h.beltSpeed() <= oreSpeed {
		t.Error("a higher belt level should carry ore faster")
	}

	h.ironOre = valueBaseCost
	if !h.apply(wire.Command{Type: wire.CmdBuy, Upgrade: wire.UpgradeOreValue}) {
		t.Fatal("the first value level should be buyable at exact cost")
	}
	if h.valueLevel != 1 || h.oreValue() != 2 {
		t.Fatalf("valueLevel=%d worth=%d after buying, want level 1 worth 2", h.valueLevel, h.oreValue())
	}

	h.ironOre = 1 << 30
	h.beltLevel = maxBeltLevel
	h.valueLevel = maxValueLevel
	if h.apply(wire.Command{Type: wire.CmdBuy, Upgrade: wire.UpgradeBeltSpeed}) {
		t.Fatal("buying past the max belt level should be rejected")
	}
	if h.apply(wire.Command{Type: wire.CmdBuy, Upgrade: wire.UpgradeOreValue}) {
		t.Fatal("buying past the max value level should be rejected")
	}
}

func TestBuyingGridSizeExpandsTheRegion(t *testing.T) {
	h := lineHub()
	h.ironOre = gridTiers[1].cost
	buy := wire.Command{Type: wire.CmdBuy, Upgrade: wire.UpgradeGridSize}

	if h.unlocked(3, 2) {
		t.Fatal("cell (3,2) should start locked on the 3x3 tier")
	}
	if !h.apply(buy) {
		t.Fatal("buying the next grid tier should succeed at exact cost")
	}
	if h.ironOre != 0 || h.gridTier != 1 {
		t.Fatalf("ore=%d tier=%d after buying, want 0 and 1", h.ironOre, h.gridTier)
	}
	if !h.unlocked(3, 2) {
		t.Error("cell (3,2) should be unlocked on the 5x4 tier")
	}

	if h.apply(buy) {
		t.Fatal("buying should be rejected when broke")
	}

	h.ironOre = 1 << 30
	h.gridTier = len(gridTiers) - 1
	if h.apply(buy) {
		t.Fatal("buying past the last tier should be rejected")
	}
}

func TestEveryTierStaysInsideTheNext(t *testing.T) {
	// A structure must never end up outside the region after an expansion, so
	// each tier's rect has to contain the one before it.
	h := shopHub()
	px0, py0, px1, py1 := h.unlockedRect()
	for tier := 1; tier < len(gridTiers); tier++ {
		h.gridTier = tier
		x0, y0, x1, y1 := h.unlockedRect()
		if x0 > px0 || y0 > py0 || x1 < px1 || y1 < py1 {
			t.Errorf("tier %d rect (%d,%d)-(%d,%d) does not contain tier %d rect (%d,%d)-(%d,%d)",
				tier, x0, y0, x1, y1, tier-1, px0, py0, px1, py1)
		}
		px0, py0, px1, py1 = x0, y0, x1, y1
	}
}
