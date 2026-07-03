package server

import (
	"github.com/luketucich/cogfab/internal/engine"
	"github.com/luketucich/cogfab/internal/wire"
)

// Everything ore buys lives here: placing structures, tearing them down for a
// partial refund, and the four upgrades (denser extractors, faster belts,
// richer ore, a bigger unlocked region). Keep the build costs in step with
// web/src/toolbar/tools.ts; the region centring has its own mirror note on
// unlockedRect below.

// startingOre covers a first extractor, belt, and seller (160 ore) with spare.
// A line stays affordable forever: upgrades only sell while ore is flowing, and
// a destroy that leaves nothing earning refunds in full, so a dead board always
// liquidates back into enough for a fresh start.
const startingOre = 250

// buildCost is what placing each structure costs; tearing one down gives back
// half (see refund).
var buildCost = map[engine.TileKind]int{
	engine.Belt:      10,
	engine.Extractor: 75,
	engine.Seller:    75,
}

// refund is the ore returned for tearing a structure down: half its build cost,
// so cycling build-and-destroy always loses ore.
func refund(kind engine.TileKind) int { return buildCost[kind] / 2 }

// The three rate upgrades, each a global level that doubles in price: Extractor
// Rate packs ore closer together (emitGap), Belt Speed carries it faster
// (beltSpeed), and Ore Value makes each delivery worth more (oreValue), all in
// economy.go.
const (
	extractorBaseCost = 150
	maxExtractorLevel = 5

	beltBaseCost = 200
	maxBeltLevel = 5

	valueBaseCost = 400
	maxValueLevel = 5
)

// gridTiers are the unlockable region sizes, smallest first. Buying Grid Size
// moves to the next tier; cost is the price of reaching that tier.
var gridTiers = []struct{ w, h, cost int }{
	{3, 3, 0},
	{5, 4, 300},
	{8, 5, 1000},
	{10, 6, 3000},
	{12, 8, 8000},
}

// doublingCost is the price of an upgrade's next level: the base, doubling per
// level, 0 once maxed.
func doublingCost(level, max, base int) int {
	if level >= max {
		return 0
	}
	return base << level
}

func (h *Hub) extractorCost() int {
	return doublingCost(h.extractorLevel, maxExtractorLevel, extractorBaseCost)
}
func (h *Hub) beltCost() int  { return doublingCost(h.beltLevel, maxBeltLevel, beltBaseCost) }
func (h *Hub) valueCost() int { return doublingCost(h.valueLevel, maxValueLevel, valueBaseCost) }

// gridCost is the price of the next grid tier, 0 once the whole world is open.
func (h *Hub) gridCost() int {
	if h.gridTier >= len(gridTiers)-1 {
		return 0
	}
	return gridTiers[h.gridTier+1].cost
}

// unlockedRect is the centred region of the world the players have bought so
// far, clamped for grids smaller than a tier (tests use tiny worlds). The
// client derives the same rect from the stats message; keep the centring in
// step with web/src/world/grid.ts.
func (h *Hub) unlockedRect() (x0, y0, x1, y1 int) {
	t := gridTiers[h.gridTier]
	x0 = max((h.world.Width()-t.w)/2, 0)
	y0 = max((h.world.Height()-t.h)/2, 0)
	x1 = min(x0+t.w, h.world.Width()) - 1
	y1 = min(y0+t.h, h.world.Height()) - 1
	return
}

// unlocked reports whether players can build on (x, y).
func (h *Hub) unlocked(x, y int) bool {
	x0, y0, x1, y1 := h.unlockedRect()
	return x >= x0 && x <= x1 && y >= y0 && y <= y1
}

// kindOf maps a wire kind to the engine's, engine.Empty when unrecognized.
func kindOf(kind string) engine.TileKind {
	switch kind {
	case wire.KindBelt:
		return engine.Belt
	case wire.KindExtractor:
		return engine.Extractor
	case wire.KindSeller:
		return engine.Seller
	}
	return engine.Empty
}

// applyPlace builds a structure and pays for it. Rejected when the kind is
// unknown, the cell is locked or occupied, or the ore does not cover it.
func (h *Hub) applyPlace(cmd wire.Command) bool {
	kind := kindOf(cmd.Kind)
	cost, buildable := buildCost[kind]
	if !buildable || !h.unlocked(cmd.X, cmd.Y) || h.world.At(cmd.X, cmd.Y).Kind != engine.Empty || cost > h.ironOre {
		return false
	}
	dir := engine.ParseDirection(cmd.Dir)
	switch kind {
	case engine.Belt:
		h.world.PlaceBelt(cmd.X, cmd.Y, dir)
	case engine.Extractor:
		h.world.PlaceExtractor(cmd.X, cmd.Y, dir)
	case engine.Seller:
		h.world.PlaceSeller(cmd.X, cmd.Y, dir)
	}
	h.ironOre -= cost
	return true
}

// applyDestroy tears a structure down for half its build cost back. When the
// destroy leaves nothing earning, the refund is the full cost instead: with no
// income the board must always liquidate back into enough for a fresh line.
func (h *Hub) applyDestroy(cmd wire.Command) bool {
	if !h.unlocked(cmd.X, cmd.Y) {
		return false
	}
	kind := h.world.At(cmd.X, cmd.Y).Kind
	if kind == engine.Empty {
		return false
	}
	h.world.Destroy(cmd.X, cmd.Y)
	back := refund(kind)
	// Ask the world, not h.routes: routes are stale here (Run recomputes them
	// only after apply returns).
	if len(h.world.Producers()) == 0 {
		back = buildCost[kind]
	}
	h.ironOre += back
	return true
}

// applyRotate turns a structure a quarter clockwise, free of charge.
func (h *Hub) applyRotate(cmd wire.Command) bool {
	if !h.unlocked(cmd.X, cmd.Y) || h.world.At(cmd.X, cmd.Y).Kind == engine.Empty {
		return false
	}
	h.world.Rotate(cmd.X, cmd.Y)
	return true
}

// applyBuy pays for an upgrade if the ore covers it and it is not maxed out.
// Upgrades only sell while ore is flowing: with income the purse always
// recovers, so no purchase can strand the game.
func (h *Hub) applyBuy(cmd wire.Command) bool {
	if len(h.routes) == 0 {
		return false
	}
	var cost int
	var level *int
	switch cmd.Upgrade {
	case wire.UpgradeExtractorRate:
		cost, level = h.extractorCost(), &h.extractorLevel
	case wire.UpgradeBeltSpeed:
		cost, level = h.beltCost(), &h.beltLevel
	case wire.UpgradeOreValue:
		cost, level = h.valueCost(), &h.valueLevel
	case wire.UpgradeGridSize:
		cost, level = h.gridCost(), &h.gridTier
	default:
		return false
	}
	if cost == 0 || cost > h.ironOre {
		return false
	}
	h.ironOre -= cost
	*level++
	return true
}
