package engine

import "testing"

func TestDepositStockNeverBecomesNegative(t *testing.T) {
	world := NewWorld(2, 1)
	world.SetDeposit(0, 0, Copper, 3)

	if got := world.Consume(0, 0, 2); got != 2 {
		t.Fatalf("first consume = %d, want 2", got)
	}
	if got := world.Consume(0, 0, 2); got != 1 {
		t.Fatalf("second consume = %d, want the final 1", got)
	}
	if got := world.Consume(0, 0, 1); got != 0 {
		t.Fatalf("empty deposit consumed %d, want 0", got)
	}
	if got := world.DepositAt(0, 0); got.Remaining != 0 || got.Capacity != 3 || got.Kind != Copper {
		t.Fatalf("depleted deposit = %+v, want copper at 0/3", got)
	}
}

func TestTerrainRemainsWhenBuildingIsDestroyed(t *testing.T) {
	world := NewWorld(2, 1)
	world.SetDeposit(0, 0, Iron, 4000)
	world.SetPort(1, 0, true)
	world.PlaceExtractor(0, 0, East)
	world.PlaceSeller(1, 0, West)

	world.Destroy(0, 0)
	world.Destroy(1, 0)

	if world.DepositAt(0, 0).Kind != Iron {
		t.Fatal("destroying the extractor removed its deposit")
	}
	if !world.HasPort(1, 0) {
		t.Fatal("destroying the seller removed its port")
	}
}

func TestRestoreDepositPreservesCapacity(t *testing.T) {
	world := NewWorld(1, 1)
	world.RestoreDeposit(0, 0, Quartz, 125, 900)
	if got := world.DepositAt(0, 0); got != (Deposit{Kind: Quartz, Remaining: 125, Capacity: 900}) {
		t.Fatalf("restored deposit = %+v", got)
	}
}
