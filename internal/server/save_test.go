package server

import (
	"os"
	"testing"

	"github.com/luketucich/cogfab/internal/engine"
	"github.com/luketucich/cogfab/internal/wire"
)

func newTestSaves(t *testing.T) *Saves {
	t.Helper()
	saves, err := NewSaves(t.TempDir())
	if err != nil {
		t.Fatalf("NewSaves: %v", err)
	}
	return saves
}

func TestSnapshotRoundTrip(t *testing.T) {
	saves := newTestSaves(t)
	h := NewHub(newTestWorld())
	h.ironOre = 1234
	h.extractorLevel, h.beltLevel, h.valueLevel, h.gridTier = 3, 2, 5, 1

	if err := saves.save("AAAAAA", h.snapshot()); err != nil {
		t.Fatalf("save: %v", err)
	}
	snap, ok := saves.load("AAAAAA")
	if !ok {
		t.Fatal("a room just saved should load")
	}

	back := hubFromSnapshot(snap)
	if back.ironOre != 1234 || back.extractorLevel != 3 || back.beltLevel != 2 || back.valueLevel != 5 || back.gridTier != 1 {
		t.Fatalf("restored purse and levels = %d %d %d %d %d, want 1234 3 2 5 1",
			back.ironOre, back.extractorLevel, back.beltLevel, back.valueLevel, back.gridTier)
	}
	for y := 0; y < 1; y++ {
		for x := 0; x < 3; x++ {
			if back.world.At(x, y) != h.world.At(x, y) {
				t.Fatalf("tile (%d,%d) = %+v, want %+v", x, y, back.world.At(x, y), h.world.At(x, y))
			}
		}
	}
}

func TestLoadRejectsJunk(t *testing.T) {
	saves := newTestSaves(t)
	if _, ok := saves.load("AAAAAA"); ok {
		t.Fatal("a code never saved should not load")
	}

	junk := map[string]string{
		"BBBBBB": `not json`,
		"CCCCCC": `{"version":999,"width":3,"height":1,"tiles":[]}`,
		"DDDDDD": `{"version":1,"width":3,"height":1,"tiles":[]}`, // tile count off
	}
	for code, body := range junk {
		if err := os.WriteFile(saves.path(code), []byte(body), 0o644); err != nil {
			t.Fatalf("write junk: %v", err)
		}
		if _, ok := saves.load(code); ok {
			t.Fatalf("junk save %q should not load", body)
		}
	}
}

func TestExpiredRoomComesBackFromDisk(t *testing.T) {
	rs := newTestRooms(t)
	rs.saves = newTestSaves(t)

	hub, _ := rs.join("AAAAAA")
	// Tear down a belt: the world changes and the purse grows by the refund,
	// giving both halves of the snapshot something to prove.
	hub.Submit(&Client{}, wire.Command{Type: wire.CmdDestroy, X: 2, Y: 0})
	rs.leave("AAAAAA")
	waitTornDown(t, hub)

	back, ok := rs.join("AAAAAA")
	if !ok || back == hub {
		t.Fatal("rejoining after expiry should build a fresh hub")
	}
	if back.world.At(2, 0).Kind != engine.Empty {
		t.Fatal("the restored room should remember the torn-down belt")
	}
	if back.ironOre == startingOre {
		t.Fatal("the restored room should remember the refunded ore, not start fresh")
	}
}

func TestShutdownSavesEveryRoom(t *testing.T) {
	rs := newTestRooms(t)
	rs.saves = newTestSaves(t)

	hub, _ := rs.join("AAAAAA")
	hub.Submit(&Client{}, wire.Command{Type: wire.CmdDestroy, X: 2, Y: 0})
	rs.Shutdown()

	snap, ok := rs.saves.load("AAAAAA")
	if !ok {
		t.Fatal("shutdown should leave a save behind")
	}
	if engine.TileKind(snap.Tiles[2].K) != engine.Empty {
		t.Fatal("the save should carry the torn-down belt")
	}
}
