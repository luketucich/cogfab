package server

import (
	"reflect"
	"testing"

	"github.com/luketucich/cogfab/internal/engine"
	"github.com/luketucich/cogfab/internal/wire"
)

// shopHub is a compact world whose centred 8x8 starter region is easy to
// exercise without allocating the full production map in every test.
func shopHub() *Hub {
	return NewHub(engine.NewWorld(12, 8))
}

// lineHub has a working extractor-belt-seller line because production upgrades
// require flowing material. Grid Size does not.
func lineHub() *Hub {
	h := shopHub()
	h.world.SetDeposit(4, 3, engine.Iron, 1_000_000)
	h.world.SetPort(6, 3, true)
	h.world.PlaceExtractor(4, 3, engine.East)
	h.world.PlaceBelt(5, 3, engine.East)
	h.world.PlaceSeller(6, 3, engine.West)
	h.recompute()
	return h
}

func prepareTerrain(h *Hub, kind engine.TileKind, placements ...wire.Placement) {
	for _, placement := range placements {
		switch kind {
		case engine.Extractor:
			h.world.SetDeposit(placement.X, placement.Y, engine.Iron, 4000)
		case engine.Seller:
			h.world.SetPort(placement.X, placement.Y, true)
		}
	}
}

func place(kind string, x, y int) wire.Command {
	return wire.Command{Type: wire.CmdPlace, X: x, Y: y, Kind: kind, Dir: "east"}
}

func placeBatch(kind string, placements ...wire.Placement) wire.Command {
	return wire.Command{Type: wire.CmdPlaceBatch, Kind: kind, Placements: placements}
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
	before := h.credits
	h.world.SetDeposit(4, 2, engine.Iron, 4000)

	if !h.apply(place(wire.KindExtractor, 4, 2)) {
		t.Fatal("placing an extractor on an unlocked empty cell should succeed")
	}
	if h.credits != before-cost {
		t.Fatalf("credits = %d after buying an extractor, want %d", h.credits, before-cost)
	}

	if !h.apply(wire.Command{Type: wire.CmdDestroy, X: 4, Y: 2}) {
		t.Fatal("destroying a structure should succeed")
	}
	if want := before - cost + cost/2; h.credits != want {
		t.Fatalf("credits = %d after the refund, want %d (half back)", h.credits, want)
	}
	if h.world.At(4, 2).Kind != engine.Empty {
		t.Error("the cell should be empty after the destroy")
	}
}

func TestDestroyingTheLastLineRefundsInFull(t *testing.T) {
	h := lineHub()
	before := h.credits

	// Tearing the extractor off the only working line leaves nothing earning,
	// so the full 75 comes back, not 37.
	if !applyAndSettle(h, wire.Command{Type: wire.CmdDestroy, X: 4, Y: 3}) {
		t.Fatal("destroying the extractor should succeed")
	}
	if h.credits != before+buildCost[engine.Extractor] {
		t.Fatalf("credits = %d, want %d (full refund when nothing earns)", h.credits, before+buildCost[engine.Extractor])
	}
}

func TestRepeatedRebuildKeepsStarterLineAffordable(t *testing.T) {
	// Spend credits in the worst refund order: build a line, then tear it down
	// starting with a piece that leaves the rest earning. The purse plus a full
	// liquidation must still cover a fresh 160-credit line.
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
	if h.credits < lineCost {
		t.Fatalf("credits = %d after churn, want at least %d so a line is still buildable", h.credits, lineCost)
	}
}

func TestPlacingIsRejectedWhenBroke(t *testing.T) {
	h := shopHub()
	h.credits = 5 // less than any structure

	if h.apply(place(wire.KindBelt, 4, 2)) {
		t.Fatal("placing should be rejected when the credits do not cover it")
	}
	if h.credits != 5 || h.world.At(4, 2).Kind != engine.Empty {
		t.Errorf("a rejected place must change nothing: credits=%d kind=%v", h.credits, h.world.At(4, 2).Kind)
	}
}

func TestPlacingIsRejectedOutsideTheUnlockedRegion(t *testing.T) {
	h := shopHub()

	if h.apply(place(wire.KindBelt, 0, 0)) {
		t.Fatal("placing outside the unlocked region should be rejected")
	}
	if h.credits != startingCredits {
		t.Errorf("credits = %d, want the untouched %d", h.credits, startingCredits)
	}
}

func TestPlacingCannotOverwrite(t *testing.T) {
	h := shopHub()
	h.apply(place(wire.KindBelt, 4, 2))
	before := h.credits

	if h.apply(place(wire.KindExtractor, 4, 2)) {
		t.Fatal("placing on an occupied cell should be rejected")
	}
	if h.world.At(4, 2).Kind != engine.Belt || h.credits != before {
		t.Errorf("the belt and credits should be untouched: kind=%v credits=%d", h.world.At(4, 2).Kind, h.credits)
	}
}

func TestTerrainControlsPlacement(t *testing.T) {
	tests := []struct {
		name    string
		kind    string
		prepare func(*engine.World)
		want    bool
	}{
		{"extractor needs a deposit", wire.KindExtractor, nil, false},
		{"extractor accepts a live deposit", wire.KindExtractor, func(w *engine.World) {
			w.SetDeposit(4, 2, engine.Iron, 4000)
		}, true},
		{"extractor rejects a depleted deposit", wire.KindExtractor, func(w *engine.World) {
			w.RestoreDeposit(4, 2, engine.Iron, 0, 4000)
		}, false},
		{"seller needs a port", wire.KindSeller, nil, false},
		{"seller accepts a port", wire.KindSeller, func(w *engine.World) {
			w.SetPort(4, 2, true)
		}, true},
		{"belt rejects a live deposit", wire.KindBelt, func(w *engine.World) {
			w.SetDeposit(4, 2, engine.Iron, 4000)
		}, false},
		{"belt rejects a port", wire.KindBelt, func(w *engine.World) {
			w.SetPort(4, 2, true)
		}, false},
		{"belt accepts a depleted deposit", wire.KindBelt, func(w *engine.World) {
			w.RestoreDeposit(4, 2, engine.Iron, 0, 4000)
		}, true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			h := shopHub()
			if test.prepare != nil {
				test.prepare(h.world)
			}
			before := h.credits
			got := h.apply(place(test.kind, 4, 2))
			if got != test.want {
				t.Fatalf("placement accepted = %v, want %v", got, test.want)
			}
			if !test.want && h.credits != before {
				t.Fatal("rejected terrain placement spent credits")
			}
		})
	}
}

func TestPlaceBatchBuildsEveryKindAtomically(t *testing.T) {
	placements := []wire.Placement{
		{X: 4, Y: 2, Dir: "east"},
		{X: 5, Y: 2, Dir: "south"},
		{X: 5, Y: 3, Dir: "south"},
	}
	tests := []struct {
		name     string
		kindName string
		kind     engine.TileKind
	}{
		{"belts", wire.KindBelt, engine.Belt},
		{"extractors", wire.KindExtractor, engine.Extractor},
		{"sellers", wire.KindSeller, engine.Seller},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			h := shopHub()
			prepareTerrain(h, test.kind, placements...)
			before := h.credits
			cmd := placeBatch(test.kindName, placements...)
			if !h.apply(cmd) {
				t.Fatal("a valid placement batch should succeed")
			}
			wantDirections := []engine.Direction{engine.East, engine.South, engine.South}
			for i, placement := range placements {
				got := h.world.At(placement.X, placement.Y)
				if got.Kind != test.kind || got.Dir != wantDirections[i] {
					t.Errorf("building %d = %+v, want %v facing %v", i, got, test.kind, wantDirections[i])
				}
			}
			if want := before - len(placements)*buildCost[test.kind]; h.credits != want {
				t.Fatalf("credits = %d after batch, want %d", h.credits, want)
			}
		})
	}
}

func TestInvalidPlaceBatchChangesNothing(t *testing.T) {
	tests := []struct {
		name    string
		prepare func(*Hub)
		command wire.Command
	}{
		{"empty", nil, placeBatch(wire.KindBelt)},
		{"unknown kind", nil, placeBatch("factory", wire.Placement{X: 4, Y: 2, Dir: "east"})},
		{"bad direction", nil, placeBatch(wire.KindBelt, wire.Placement{X: 4, Y: 2, Dir: "sideways"})},
		{"duplicate cell", nil, placeBatch(wire.KindBelt,
			wire.Placement{X: 4, Y: 2, Dir: "east"},
			wire.Placement{X: 4, Y: 2, Dir: "east"},
		)},
		{"locked cell", nil, placeBatch(wire.KindBelt,
			wire.Placement{X: 4, Y: 2, Dir: "west"},
			wire.Placement{X: 1, Y: 2, Dir: "west"},
		)},
		{"occupied cell", func(h *Hub) { h.world.PlaceExtractor(5, 2, engine.East) }, placeBatch(wire.KindSeller,
			wire.Placement{X: 4, Y: 2, Dir: "east"},
			wire.Placement{X: 5, Y: 2, Dir: "east"},
		)},
		{"not enough credits", func(h *Hub) {
			h.credits = 149
			prepareTerrain(h, engine.Extractor,
				wire.Placement{X: 4, Y: 2}, wire.Placement{X: 5, Y: 2})
		}, placeBatch(wire.KindExtractor,
			wire.Placement{X: 4, Y: 2, Dir: "east"},
			wire.Placement{X: 5, Y: 2, Dir: "east"},
		)},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			h := shopHub()
			if test.prepare != nil {
				test.prepare(h)
			}
			before := h.snapshot()
			if h.apply(test.command) {
				t.Fatal("invalid placement batch should be rejected")
			}
			if after := h.snapshot(); !reflect.DeepEqual(after, before) {
				t.Fatalf("rejected batch changed the room\nbefore: %+v\nafter:  %+v", before, after)
			}
		})
	}
}

func TestOverlappingPlaceBatchesDoNotPartlyApply(t *testing.T) {
	h := shopHub()
	first := placeBatch(wire.KindBelt,
		wire.Placement{X: 4, Y: 2, Dir: "east"},
		wire.Placement{X: 5, Y: 2, Dir: "east"},
	)
	second := placeBatch(wire.KindSeller,
		wire.Placement{X: 5, Y: 2, Dir: "east"},
		wire.Placement{X: 6, Y: 2, Dir: "east"},
	)

	if !h.apply(first) {
		t.Fatal("the first batch should succeed")
	}
	beforeSecond := h.snapshot()
	if h.apply(second) {
		t.Fatal("the overlapping batch should be rejected")
	}
	if after := h.snapshot(); !reflect.DeepEqual(after, beforeSecond) {
		t.Fatal("the overlapping batch partly changed the room")
	}
}

func TestDestroyingNothingGivesNothing(t *testing.T) {
	h := shopHub()

	if h.apply(wire.Command{Type: wire.CmdDestroy, X: 4, Y: 2}) {
		t.Fatal("destroying an empty cell should be a rejected no-op")
	}
	if h.credits != startingCredits {
		t.Errorf("credits = %d, want the untouched %d", h.credits, startingCredits)
	}
}

func TestRotatingIsFreeAndGuarded(t *testing.T) {
	h := shopHub()
	h.world.SetDeposit(4, 2, engine.Iron, 4000)
	h.apply(place(wire.KindExtractor, 4, 2))
	before := h.credits

	if !h.apply(wire.Command{Type: wire.CmdRotate, X: 4, Y: 2}) {
		t.Fatal("rotating a structure should succeed")
	}
	if got := h.world.At(4, 2).Dir; got != engine.South {
		t.Errorf("dir = %v after rotating an east extractor, want south", got)
	}
	if h.credits != before {
		t.Errorf("credits = %d after a rotate, want the untouched %d (rotating is free)", h.credits, before)
	}

	if h.apply(wire.Command{Type: wire.CmdRotate, X: 5, Y: 2}) {
		t.Error("rotating an empty cell should be a rejected no-op")
	}
	if h.apply(wire.Command{Type: wire.CmdRotate, X: 0, Y: 0}) {
		t.Error("rotating outside the unlocked region should be rejected")
	}
}

func TestDestroyAndRotateHonorExpectedTile(t *testing.T) {
	tests := []struct {
		name string
		cmd  wire.Command
	}{
		{
			name: "destroy kind changed",
			cmd: wire.Command{
				Type: wire.CmdDestroy, X: 4, Y: 2,
				ExpectedKind: wire.KindSeller, ExpectedDir: "east",
			},
		},
		{
			name: "destroy direction changed",
			cmd: wire.Command{
				Type: wire.CmdDestroy, X: 4, Y: 2,
				ExpectedKind: wire.KindBelt, ExpectedDir: "south",
			},
		},
		{
			name: "rotate kind changed",
			cmd: wire.Command{
				Type: wire.CmdRotate, X: 4, Y: 2,
				ExpectedKind: wire.KindExtractor, ExpectedDir: "east",
			},
		},
		{
			name: "rotate direction changed",
			cmd: wire.Command{
				Type: wire.CmdRotate, X: 4, Y: 2,
				ExpectedKind: wire.KindBelt, ExpectedDir: "south",
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			h := shopHub()
			h.world.PlaceBelt(4, 2, engine.East)
			before := h.snapshot()
			if h.apply(test.cmd) {
				t.Fatal("stale command should be rejected")
			}
			if after := h.snapshot(); !reflect.DeepEqual(after, before) {
				t.Fatal("stale command changed the room")
			}
		})
	}

	h := shopHub()
	h.world.PlaceBelt(4, 2, engine.East)
	if !h.apply(wire.Command{
		Type: wire.CmdRotate, X: 4, Y: 2,
		ExpectedKind: wire.KindBelt, ExpectedDir: "east",
	}) {
		t.Fatal("matching precondition should be accepted")
	}
	if got := h.world.At(4, 2).Dir; got != engine.South {
		t.Fatalf("matching rotate produced %v, want south", got)
	}
}

func TestProductionUpgradesNeedIncome(t *testing.T) {
	h := shopHub() // empty world: nothing earning
	h.credits = 1 << 30

	if h.apply(wire.Command{Type: wire.CmdBuy, Upgrade: wire.UpgradeExtractorRate}) {
		t.Fatal("upgrades should not sell while nothing is earning")
	}
	if !h.apply(wire.Command{Type: wire.CmdBuy, Upgrade: wire.UpgradeGridSize}) {
		t.Fatal("land should remain buyable after production stops")
	}
}

func TestBuyingExtractorRate(t *testing.T) {
	h := lineHub()
	buy := wire.Command{Type: wire.CmdBuy, Upgrade: wire.UpgradeExtractorRate}
	reserve := h.gridCost()

	h.credits = reserve + extractorBaseCost - 1
	if h.apply(buy) {
		t.Fatal("a production upgrade should not spend the next land unlock's credits")
	}
	if h.extractorLevel != 0 || h.credits != reserve+extractorBaseCost-1 {
		t.Fatal("a rejected production upgrade should change nothing")
	}

	h.credits++
	if !h.apply(buy) {
		t.Fatal("the first extractor level should be buyable above the land reserve")
	}
	if h.extractorLevel != 1 || h.credits != reserve {
		t.Fatalf("level=%d credits=%d after buying, want level 1 and reserve %d", h.extractorLevel, h.credits, reserve)
	}
	if h.emitGap() >= materialGap {
		t.Error("a higher level should emit material closer together")
	}

	h.credits = 0
	if h.apply(buy) {
		t.Fatal("buying should be rejected when broke")
	}
}

func TestProductionUpgradeHasNoReserveAtMaxGrid(t *testing.T) {
	h := lineHub()
	h.gridTier = len(gridTiers) - 1
	h.credits = h.extractorCost()

	if !h.apply(wire.Command{Type: wire.CmdBuy, Upgrade: wire.UpgradeExtractorRate}) {
		t.Fatal("a production upgrade should use the full balance once all land is open")
	}
	if h.credits != 0 || h.extractorLevel != 1 {
		t.Fatalf("credits=%d level=%d after buying, want 0 and 1", h.credits, h.extractorLevel)
	}
}

func TestSaleValuePaybackSlowsEveryLevel(t *testing.T) {
	// The heart of the rebalance: prices double but payouts step up linearly,
	// so each Sale Value level takes longer to pay for itself than the last.
	h := lineHub()
	var last float64
	for level := 0; level < 12; level++ {
		h.valueLevel = level
		cost, before := float64(h.valueCost()), h.currentRate()
		h.valueLevel = level + 1
		payback := cost / (h.currentRate() - before)
		if payback <= last {
			t.Fatalf("level %d pays back in %.0fs, no slower than level %d's %.0fs", level+1, payback, level, last)
		}
		last = payback
	}
}

func TestRateUpgradesNeverMaxOut(t *testing.T) {
	h := lineHub()
	h.extractorLevel, h.beltLevel, h.valueLevel = 30, 30, 30
	if h.extractorCost() <= 0 || h.beltCost() <= 0 || h.valueCost() <= 0 {
		t.Fatalf("deep levels must still price a next level: %d %d %d", h.extractorCost(), h.beltCost(), h.valueCost())
	}
}

func TestBuyingBeltSpeedAndSaleValue(t *testing.T) {
	h := lineHub()
	reserve := h.gridCost()

	h.credits = reserve + beltBaseCost
	if !h.apply(wire.Command{Type: wire.CmdBuy, Upgrade: wire.UpgradeBeltSpeed}) {
		t.Fatal("the first belt level should be buyable above the land reserve")
	}
	if h.beltLevel != 1 || h.credits != reserve {
		t.Fatalf("beltLevel=%d credits=%d after buying, want level 1 and reserve %d", h.beltLevel, h.credits, reserve)
	}
	if h.beltSpeed() <= materialSpeed {
		t.Error("a higher belt level should carry material faster")
	}

	h.credits = reserve + valueBaseCost
	if !h.apply(wire.Command{Type: wire.CmdBuy, Upgrade: wire.UpgradeSaleValue}) {
		t.Fatal("the first value level should be buyable above the land reserve")
	}
	if h.valueLevel != 1 || h.saleValueMultiplier() != 2 || h.credits != reserve {
		t.Fatalf(
			"valueLevel=%d worth=%v credits=%d after buying, want level 1 worth 2 and reserve %d",
			h.valueLevel, h.saleValueMultiplier(), h.credits, reserve,
		)
	}
}

func TestBuyingGridSizeExpandsTheRegion(t *testing.T) {
	h := lineHub()
	h.credits = gridTiers[1].cost
	buy := wire.Command{Type: wire.CmdBuy, Upgrade: wire.UpgradeGridSize}

	if h.unlocked(1, 2) {
		t.Fatal("cell (1,2) should start locked on the 8x8 tier")
	}
	if !h.apply(buy) {
		t.Fatal("buying the next grid tier should succeed at exact cost")
	}
	if h.credits != 0 || h.gridTier != 1 {
		t.Fatalf("credits=%d tier=%d after buying, want 0 and 1", h.credits, h.gridTier)
	}
	if !h.unlocked(1, 2) {
		t.Error("cell (1,2) should be unlocked on the 12x12 tier")
	}

	if h.apply(buy) {
		t.Fatal("buying should be rejected when broke")
	}

	h.credits = 1 << 30
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
