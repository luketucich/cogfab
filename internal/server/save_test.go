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

func TestLoadRejectsUnreadableFiles(t *testing.T) {
	saves := newTestSaves(t)
	if _, ok := saves.load("AAAAAA"); ok {
		t.Fatal("a code never saved should not load")
	}

	if err := os.WriteFile(saves.path("BBBBBB"), []byte("not json"), 0o644); err != nil {
		t.Fatalf("write junk: %v", err)
	}
	if _, ok := saves.load("BBBBBB"); ok {
		t.Fatal("malformed JSON should not load")
	}
}

func TestLoadRejectsInvalidSnapshots(t *testing.T) {
	saves := newTestSaves(t)
	valid := NewHub(newTestWorld()).snapshot()
	largestGrid := gridTiers[len(gridTiers)-1]

	tests := []struct {
		name   string
		mutate func(*snapshot)
	}{
		{"wrong version", func(s *snapshot) { s.Version++ }},
		{"zero width", func(s *snapshot) { s.Width = 0 }},
		{"zero height", func(s *snapshot) { s.Height = 0 }},
		{"width above largest grid", func(s *snapshot) {
			s.Width, s.Height = largestGrid.w+1, 1
			s.Tiles = make([]savedTile, s.Width)
		}},
		{"height above largest grid", func(s *snapshot) {
			s.Width, s.Height = 1, largestGrid.h+1
			s.Tiles = make([]savedTile, s.Height)
		}},
		{"wrong tile count", func(s *snapshot) { s.Tiles = s.Tiles[:len(s.Tiles)-1] }},
		{"unknown tile kind", func(s *snapshot) { s.Tiles[0].K = uint8(engine.Seller) + 1 }},
		{"unknown direction", func(s *snapshot) { s.Tiles[0].D = uint8(engine.West) + 1 }},
		{"negative ore", func(s *snapshot) { s.IronOre = -1 }},
		{"negative extractor level", func(s *snapshot) { s.ExtractorLevel = -1 }},
		{"negative belt level", func(s *snapshot) { s.BeltLevel = -1 }},
		{"negative value level", func(s *snapshot) { s.ValueLevel = -1 }},
		{"negative grid tier", func(s *snapshot) { s.GridTier = -1 }},
		{"grid tier past final", func(s *snapshot) { s.GridTier = len(gridTiers) }},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			snap := valid
			snap.Tiles = append([]savedTile(nil), valid.Tiles...)
			test.mutate(&snap)
			if err := saves.save("AAAAAA", snap); err != nil {
				t.Fatalf("save invalid snapshot: %v", err)
			}
			if _, ok := saves.load("AAAAAA"); ok {
				t.Fatal("invalid snapshot should not load")
			}
		})
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
