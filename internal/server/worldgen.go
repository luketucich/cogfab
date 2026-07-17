package server

import (
	"hash/fnv"
	"math/rand"
	"strings"

	"github.com/luketucich/cogfab/internal/engine"
)

const resourceWorldSize = 64

// NewResourceWorld creates the stable terrain for a new room. The room code is
// the seed, so reconnecting to an unsaved room never rerolls its resources.
func NewResourceWorld(code string) *engine.World {
	world := engine.NewWorld(resourceWorldSize, resourceWorldSize)
	rng := rand.New(rand.NewSource(roomSeed(code)))

	placeStarterTerrain(world, rng)
	for tier := 1; tier < len(gridTiers); tier++ {
		cells := tierCells(world, tier)
		rng.Shuffle(len(cells), func(i, j int) { cells[i], cells[j] = cells[j], cells[i] })

		if tier%4 == 0 {
			placePort(world, cells)
		}
		count := max(2, len(cells)/32)
		placeDeposits(world, rng, cells, tier, count, guaranteedResource(tier))
	}
	return world
}

type cell struct{ x, y int }

func placeStarterTerrain(world *engine.World, rng *rand.Rand) {
	x0, y0, x1, y1 := tierRect(world, 0)
	px, py := x0+3+rng.Intn(2), y0+3+rng.Intn(2)
	world.SetPort(px, py, true)

	candidates := []cell{{x0 + 1, y0 + 1}, {x1 - 1, y1 - 1}}
	if rng.Intn(2) == 1 {
		candidates = []cell{{x1 - 1, y0 + 1}, {x0 + 1, y1 - 1}}
	}
	for _, c := range candidates {
		world.SetDeposit(c.x, c.y, engine.Iron, depositAmount(rng, engine.Iron))
	}
}

func tierCells(world *engine.World, tier int) []cell {
	x0, y0, x1, y1 := tierRect(world, tier)
	px0, py0, px1, py1 := tierRect(world, tier-1)
	cells := make([]cell, 0, (x1-x0+1)*(y1-y0+1))
	for y := y0; y <= y1; y++ {
		for x := x0; x <= x1; x++ {
			if x >= px0 && x <= px1 && y >= py0 && y <= py1 {
				continue
			}
			cells = append(cells, cell{x, y})
		}
	}
	return cells
}

func placePort(world *engine.World, cells []cell) {
	for _, c := range cells {
		if resourceCellClear(world, c.x, c.y) {
			world.SetPort(c.x, c.y, true)
			return
		}
	}
}

func placeDeposits(
	world *engine.World,
	rng *rand.Rand,
	cells []cell,
	tier, count int,
	guaranteed engine.ResourceKind,
) {
	for _, c := range cells {
		if count == 0 {
			return
		}
		if !resourceCellClear(world, c.x, c.y) {
			continue
		}
		kind := guaranteed
		if kind == engine.NoResource {
			kind = resourceForTier(rng.Intn(100), tier)
		} else {
			guaranteed = engine.NoResource
		}
		world.SetDeposit(c.x, c.y, kind, depositAmount(rng, kind))
		count--
	}
}

func guaranteedResource(tier int) engine.ResourceKind {
	switch tier {
	case 1:
		return engine.Copper
	case 4:
		return engine.Quartz
	case 10:
		return engine.Gold
	default:
		return engine.NoResource
	}
}

func resourceCellClear(world *engine.World, x, y int) bool {
	if world.HasPort(x, y) || world.DepositAt(x, y).Kind != engine.NoResource {
		return false
	}
	for dy := -2; dy <= 2; dy++ {
		for dx := -2; dx <= 2; dx++ {
			if abs(dx)+abs(dy) >= 3 {
				continue
			}
			if world.HasPort(x+dx, y+dy) || world.DepositAt(x+dx, y+dy).Kind != engine.NoResource {
				return false
			}
		}
	}
	return true
}

func resourceForTier(roll, tier int) engine.ResourceKind {
	switch {
	case tier <= 3:
		if roll < 80 {
			return engine.Iron
		}
		return engine.Copper
	case tier <= 7:
		switch {
		case roll < 60:
			return engine.Iron
		case roll < 88:
			return engine.Copper
		case roll < 98:
			return engine.Quartz
		default:
			return engine.Gold
		}
	default:
		switch {
		case roll < 50:
			return engine.Iron
		case roll < 80:
			return engine.Copper
		case roll < 95:
			return engine.Quartz
		default:
			return engine.Gold
		}
	}
}

func depositAmount(rng *rand.Rand, kind engine.ResourceKind) int {
	min, max := 3000, 5000
	switch kind {
	case engine.Copper:
		min, max = 1800, 3000
	case engine.Quartz:
		min, max = 900, 1500
	case engine.Gold:
		min, max = 450, 750
	}
	return min + rng.Intn(max-min+1)
}

func roomSeed(code string) int64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte(strings.ToUpper(code)))
	return int64(h.Sum64())
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}
