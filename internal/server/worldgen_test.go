package server

import (
	"fmt"
	"reflect"
	"testing"

	"github.com/luketucich/cogfab/internal/engine"
)

type terrainSnapshot struct {
	deposits []savedDeposit
	ports    []savedCell
}

func terrainOf(world *engine.World) terrainSnapshot {
	var terrain terrainSnapshot
	for y := 0; y < world.Height(); y++ {
		for x := 0; x < world.Width(); x++ {
			if d := world.DepositAt(x, y); d.Kind != engine.NoResource {
				terrain.deposits = append(terrain.deposits, savedDeposit{
					X: x, Y: y, K: uint8(d.Kind), Remaining: d.Remaining, Capacity: d.Capacity,
				})
			}
			if world.HasPort(x, y) {
				terrain.ports = append(terrain.ports, savedCell{X: x, Y: y})
			}
		}
	}
	return terrain
}

func TestResourceWorldIsStableForRoomCode(t *testing.T) {
	first := NewResourceWorld("ABC123")
	second := NewResourceWorld("abc123")
	other := NewResourceWorld("XYZ789")

	if first.Width() != resourceWorldSize || first.Height() != resourceWorldSize {
		t.Fatalf("world = %dx%d, want %dx%d", first.Width(), first.Height(), resourceWorldSize, resourceWorldSize)
	}
	if !reflect.DeepEqual(terrainOf(first), terrainOf(second)) {
		t.Fatal("the same room code generated different terrain")
	}
	if reflect.DeepEqual(terrainOf(first), terrainOf(other)) {
		t.Fatal("different room codes generated identical terrain")
	}
}

func TestStarterRegionGuaranteesIronAndPort(t *testing.T) {
	world := NewResourceWorld("START1")
	x0, y0, x1, y1 := tierRect(world, 0)
	deposits, ports := 0, 0
	for y := y0; y <= y1; y++ {
		for x := x0; x <= x1; x++ {
			if d := world.DepositAt(x, y); d.Kind != engine.NoResource {
				deposits++
				if d.Kind != engine.Iron {
					t.Fatalf("starter deposit at (%d,%d) is %s, want iron", x, y, d.Kind)
				}
			}
			if world.HasPort(x, y) {
				ports++
			}
		}
	}
	if deposits != 2 || ports != 1 {
		t.Fatalf("starter terrain has %d deposits and %d ports, want 2 and 1", deposits, ports)
	}
	if got := len(terrainOf(world).ports); got != 4 {
		t.Fatalf("whole world has %d ports, want starter plus three later ports", got)
	}
}

func TestEveryExpansionAddsDeposits(t *testing.T) {
	world := NewResourceWorld("EXPAND")
	for tier := 1; tier < len(gridTiers); tier++ {
		count := 0
		for _, c := range tierCells(world, tier) {
			if world.DepositAt(c.x, c.y).Kind != engine.NoResource {
				count++
			}
		}
		if count < 2 {
			t.Errorf("tier %d adds %d deposits, want at least 2", tier, count)
		}
	}
}

func TestResourceRarityMovesOutward(t *testing.T) {
	tests := []struct {
		roll, tier int
		want       engine.ResourceKind
	}{
		{79, 1, engine.Iron}, {80, 1, engine.Copper},
		{59, 4, engine.Iron}, {60, 4, engine.Copper}, {88, 4, engine.Quartz}, {98, 4, engine.Gold},
		{49, 8, engine.Iron}, {50, 8, engine.Copper}, {80, 8, engine.Quartz}, {95, 8, engine.Gold},
	}
	for _, test := range tests {
		if got := resourceForTier(test.roll, test.tier); got != test.want {
			t.Errorf("roll %d at tier %d = %s, want %s", test.roll, test.tier, got, test.want)
		}
	}
}

func TestEveryWorldContainsAllRawMaterials(t *testing.T) {
	for i := 0; i < 100; i++ {
		world := NewResourceWorld(fmt.Sprintf("R%05d", i))
		found := make(map[engine.ResourceKind]bool)
		for _, deposit := range terrainOf(world).deposits {
			found[engine.ResourceKind(deposit.K)] = true
		}
		for _, kind := range []engine.ResourceKind{engine.Iron, engine.Copper, engine.Quartz, engine.Gold} {
			if !found[kind] {
				t.Fatalf("room %d has no %s deposit", i, kind)
			}
		}
	}
}

func TestExpansionResourcesCanFundProgression(t *testing.T) {
	lineCost := buildCost[engine.Extractor] +
		2*resourceWorldSize*buildCost[engine.Belt] +
		buildCost[engine.Seller]
	for room := 0; room < 40; room++ {
		world := NewResourceWorld(fmt.Sprintf("S%05d", room))
		capacityCredits := 0
		gridCosts := 0
		for tier := range gridTiers {
			cells := tierCellsForCapacity(world, tier)
			for _, c := range cells {
				deposit := world.DepositAt(c.x, c.y)
				capacityCredits += deposit.Capacity * rawValue(deposit.Kind)
			}
			if tier == len(gridTiers)-1 {
				continue
			}
			gridCosts += gridTiers[tier+1].cost
			if capacityCredits < gridCosts+lineCost {
				t.Fatalf(
					"room %d tier %d has %d potential credits, need %d for progression and a full-world line",
					room, tier, capacityCredits, gridCosts+lineCost,
				)
			}
		}
	}
}

func tierCellsForCapacity(world *engine.World, tier int) []cell {
	if tier > 0 {
		return tierCells(world, tier)
	}
	x0, y0, x1, y1 := tierRect(world, 0)
	var cells []cell
	for y := y0; y <= y1; y++ {
		for x := x0; x <= x1; x++ {
			cells = append(cells, cell{x, y})
		}
	}
	return cells
}
