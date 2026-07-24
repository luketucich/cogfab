package server

import (
	"github.com/luketucich/cogfab/internal/engine"
	"github.com/luketucich/cogfab/internal/wire"
)

// Everything credits buy lives here: structures, refunds, and the four
// upgrades. Keep build costs in step with web/src/toolbar/tools.ts; the region
// centring has its own mirror note on unlockedRect below.

// startingCredits covers a first extractor, seller, and several connecting
// belts. Production upgrades require a live line, and tearing down the last
// productive structure refunds its full cost so the room can rebuild.
const startingCredits = 250

// buildCost is what placing each structure costs; tearing one down gives back
// half (see refund).
var buildCost = map[engine.TileKind]int{
	engine.Belt:      10,
	engine.Extractor: 75,
	engine.Seller:    75,
	engine.Refiner:   150,
}

// refund is the credit returned for tearing a structure down: half its build
// cost, so cycling build-and-destroy always loses credits.
func refund(kind engine.TileKind) int { return buildCost[kind] / 2 }

// Rate upgrade prices double through every practical level while their gains
// increase linearly, so additional production lines eventually outperform
// another upgrade. Those lines need more land, which keeps Grid Size useful.
// Extractor Rate changes emitGap, Belt Speed changes beltSpeed, and Sale Value
// changes saleValueMultiplier in economy.go.
const (
	extractorBaseCost = 150
	beltBaseCost      = 200
	valueBaseCost     = 400
	refinerBaseCost   = 250
	maxUpgradeLevel   = 40
)

// gridTiers are the unlockable region sizes, smallest first. Buying Grid Size
// moves to the next tier; cost is the price of reaching that tier.
var gridTiers = []struct{ w, h, cost int }{
	{8, 8, 0},
	{12, 12, 300},
	{16, 16, 500},
	{20, 20, 800},
	{24, 24, 1300},
	{28, 28, 2100},
	{32, 32, 3400},
	{36, 36, 5500},
	{40, 40, 8800},
	{44, 44, 14100},
	{48, 48, 22600},
	{52, 52, 36200},
	{56, 56, 58000},
	{60, 60, 92800},
	{64, 64, 148500},
}

// doublingCost is the price of an upgrade's next level: the base, doubling per
// level. Level 40 is the practical ceiling; returning zero there uses the wire
// format's existing "maxed" state and keeps every multiplier and price in a
// range the server and browser can represent safely.
func doublingCost(level, base int) int {
	if level < 0 || level >= maxUpgradeLevel {
		return 0
	}
	return base << level
}

func (h *Hub) extractorCost() int { return doublingCost(h.extractorLevel, extractorBaseCost) }
func (h *Hub) beltCost() int      { return doublingCost(h.beltLevel, beltBaseCost) }
func (h *Hub) valueCost() int     { return doublingCost(h.valueLevel, valueBaseCost) }
func (h *Hub) refinerCost() int   { return doublingCost(h.refinerLevel, refinerBaseCost) }

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
	return tierRect(h.world, h.gridTier)
}

func tierRect(world *engine.World, tier int) (x0, y0, x1, y1 int) {
	t := gridTiers[tier]
	x0 = max((world.Width()-t.w)/2, 0)
	y0 = max((world.Height()-t.h)/2, 0)
	x1 = min(x0+t.w, world.Width()) - 1
	y1 = min(y0+t.h, world.Height()) - 1
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
	case wire.KindRefiner:
		return engine.Refiner
	}
	return engine.Empty
}

// applyPlace keeps the single-cell wire command on the same validation path as
// drag batches.
func (h *Hub) applyPlace(cmd wire.Command) bool {
	return h.applyPlacements(cmd.Kind, []wire.Placement{{X: cmd.X, Y: cmd.Y, Dir: cmd.Dir}})
}

// applyPlaceBatch validates a whole drag before placing any of it.
func (h *Hub) applyPlaceBatch(cmd wire.Command) bool {
	return h.applyPlacements(cmd.Kind, cmd.Placements)
}

// placementOccupancyAllows keeps ordinary builds empty-cell-only while letting
// a refiner upgrade a belt in place.
func placementOccupancyAllows(kind, existing engine.TileKind) bool {
	return existing == engine.Empty || kind == engine.Refiner && existing == engine.Belt
}

// applyPlacements is the authoritative path for every build. Commands run one
// at a time, so the first valid overlapping batch wins and the next fails.
func (h *Hub) applyPlacements(kindName string, placements []wire.Placement) bool {
	kind := kindOf(kindName)
	unitCost, buildable := buildCost[kind]
	if !buildable || len(placements) == 0 || len(placements) > h.world.Width()*h.world.Height() {
		return false
	}
	cost := len(placements) * unitCost
	if cost > h.credits {
		return false
	}

	seen := make(map[int]bool, len(placements))
	directions := make([]engine.Direction, len(placements))
	for i, placement := range placements {
		if !validDirection(placement.Dir) || !h.unlocked(placement.X, placement.Y) {
			return false
		}
		existing := h.world.At(placement.X, placement.Y)
		if !placementOccupancyAllows(kind, existing.Kind) ||
			!h.terrainAllows(kind, placement.X, placement.Y) {
			return false
		}
		cell := placement.Y*h.world.Width() + placement.X
		if seen[cell] {
			return false
		}
		seen[cell] = true

		directions[i] = engine.ParseDirection(placement.Dir)
		if kind == engine.Refiner && existing.Kind == engine.Belt {
			direction, straight := h.world.StraightBeltDirection(placement.X, placement.Y)
			if !straight {
				return false
			}
			directions[i] = direction
		}
	}

	for i, placement := range placements {
		dir := directions[i]
		switch kind {
		case engine.Belt:
			h.world.PlaceBelt(placement.X, placement.Y, dir)
		case engine.Extractor:
			h.world.PlaceExtractor(placement.X, placement.Y, dir)
		case engine.Seller:
			h.world.PlaceSeller(placement.X, placement.Y, dir)
		case engine.Refiner:
			h.world.PlaceRefiner(placement.X, placement.Y, dir)
		}
	}
	h.credits -= cost
	return true
}

func (h *Hub) terrainAllows(kind engine.TileKind, x, y int) bool {
	deposit := h.world.DepositAt(x, y)
	switch kind {
	case engine.Extractor:
		return deposit.Kind != engine.NoResource && deposit.Remaining > 0 && !h.world.HasPort(x, y)
	case engine.Seller:
		return h.world.HasPort(x, y) && deposit.Kind == engine.NoResource
	case engine.Belt, engine.Refiner:
		return !h.world.HasPort(x, y) && (deposit.Kind == engine.NoResource || deposit.Remaining == 0)
	default:
		return false
	}
}

// applyDestroy tears a structure down for half its build cost back. When the
// destroy leaves nothing earning, the refund is the full cost instead: with no
// income the board must always liquidate back into enough for a fresh line.
func (h *Hub) applyDestroy(cmd wire.Command) bool {
	if !h.unlocked(cmd.X, cmd.Y) {
		return false
	}
	tile := h.world.At(cmd.X, cmd.Y)
	kind := tile.Kind
	if kind == engine.Empty {
		return false
	}
	if !matchesExpectedTile(tile, cmd) {
		return false
	}
	h.world.Destroy(cmd.X, cmd.Y)
	back := refund(kind)
	// Ask the world, not h.routes: routes are stale here (Run recomputes them
	// only after apply returns).
	if !h.hasActiveProducer() {
		back = buildCost[kind]
	}
	h.credits = addCredits(h.credits, back)
	return true
}

func (h *Hub) hasActiveProducer() bool {
	for _, producer := range h.world.Producers() {
		x, y := producer.Cell%h.world.Width(), producer.Cell/h.world.Width()
		if h.world.DepositAt(x, y).Remaining > 0 {
			return true
		}
	}
	return false
}

// applyRotate turns a structure a quarter clockwise, free of charge.
func (h *Hub) applyRotate(cmd wire.Command) bool {
	if !h.unlocked(cmd.X, cmd.Y) {
		return false
	}
	tile := h.world.At(cmd.X, cmd.Y)
	if tile.Kind == engine.Empty || !matchesExpectedTile(tile, cmd) {
		return false
	}
	h.world.Rotate(cmd.X, cmd.Y)
	return true
}

// matchesExpectedTile turns optional client preconditions into a compare-and-
// set guard. Older clients omit both fields and keep their existing behaviour.
func matchesExpectedTile(tile engine.Tile, cmd wire.Command) bool {
	if cmd.ExpectedKind != "" && tile.Kind.String() != cmd.ExpectedKind {
		return false
	}
	return cmd.ExpectedDir == "" || tile.Dir.String() == cmd.ExpectedDir
}

// applyBuy pays for an upgrade if the shared credits cover it and it is not
// maxed out. Production upgrades require a live route and leave the next land
// unlock's price untouched. Grid Size can spend that reserve without income,
// and the reserve disappears once the whole world is open.
func (h *Hub) applyBuy(cmd wire.Command) bool {
	var cost int
	var level *int
	var rescaleRefinerJobs bool
	productionUpgrade := true
	switch cmd.Upgrade {
	case wire.UpgradeExtractorRate:
		cost, level = h.extractorCost(), &h.extractorLevel
	case wire.UpgradeBeltSpeed:
		cost, level = h.beltCost(), &h.beltLevel
	case wire.UpgradeSaleValue:
		cost, level = h.valueCost(), &h.valueLevel
	case wire.UpgradeRefinerSpeed:
		cost, level = h.refinerCost(), &h.refinerLevel
		rescaleRefinerJobs = true
	case wire.UpgradeGridSize:
		productionUpgrade = false
		cost, level = h.gridCost(), &h.gridTier
	default:
		return false
	}
	spendable := h.credits
	if productionUpgrade {
		if len(h.routes) == 0 {
			return false
		}
		spendable -= h.gridCost()
	}
	if cost == 0 || cost > spendable {
		return false
	}
	h.credits -= cost
	previousRefineTime := 0.0
	if rescaleRefinerJobs {
		previousRefineTime = h.refineTime()
	}
	*level++
	if rescaleRefinerJobs {
		scale := h.refineTime() / previousRefineTime
		for _, owner := range h.refinerBusy {
			owner.processLeft *= scale
		}
	}
	return true
}
