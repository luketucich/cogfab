package server

import (
	"context"
	"os"
	"reflect"
	"testing"
	"time"

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
	h := NewHub(NewResourceWorld("AAAAAA"))
	h.credits = 1234
	h.extractorLevel, h.beltLevel, h.valueLevel, h.gridTier = 3, 2, 5, 1
	before := h.snapshot()

	if err := saves.save("AAAAAA", h.snapshot()); err != nil {
		t.Fatalf("save: %v", err)
	}
	snap, ok := saves.load("AAAAAA")
	if !ok {
		t.Fatal("a room just saved should load")
	}

	back := hubFromSnapshot(snap, "SAVED1")
	if back.credits != 1234 || back.extractorLevel != 3 || back.beltLevel != 2 || back.valueLevel != 5 || back.gridTier != 1 {
		t.Fatalf("restored purse and levels = %d %d %d %d %d, want 1234 3 2 5 1",
			back.credits, back.extractorLevel, back.beltLevel, back.valueLevel, back.gridTier)
	}
	if after := back.snapshot(); !reflect.DeepEqual(after, before) {
		t.Fatal("restored world terrain does not match the saved snapshot")
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
	valid := NewHub(NewResourceWorld("VALID1")).snapshot()
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
		{"negative credits", func(s *snapshot) { s.Credits = -1 }},
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

func TestV1SnapshotMigratesIntoResourceWorld(t *testing.T) {
	saves := newTestSaves(t)
	legacy := `{
		"version":1,
		"width":3,
		"height":1,
		"tiles":[{"k":2,"d":1},{"k":1,"d":1},{"k":3,"d":3}],
		"ironOre":777,
		"extractorLevel":2,
		"beltLevel":3,
		"valueLevel":4,
		"gridTier":4
	}`
	if err := os.WriteFile(saves.path("LEGACY"), []byte(legacy), 0o644); err != nil {
		t.Fatalf("write legacy save: %v", err)
	}
	snap, ok := saves.load("LEGACY")
	if !ok {
		t.Fatal("valid version 1 save did not load")
	}
	h := hubFromSnapshot(snap, "LEGACY")
	x, y := (resourceWorldSize-3)/2, (resourceWorldSize-1)/2
	if h.world.At(x, y).Kind != engine.Extractor || h.world.DepositAt(x, y).Kind != engine.Iron {
		t.Fatal("legacy extractor was not centred onto an iron deposit")
	}
	if h.world.At(x+1, y).Kind != engine.Belt {
		t.Fatal("legacy belt was not centred in the new world")
	}
	if h.world.At(x+2, y).Kind != engine.Seller || !h.world.HasPort(x+2, y) {
		t.Fatal("legacy seller was not centred onto a shipping port")
	}
	if h.credits != 777 || h.extractorLevel != 2 || h.beltLevel != 3 || h.valueLevel != 4 || h.gridTier != 4 {
		t.Fatalf("legacy economy was not preserved: %+v", h.snapshot())
	}
	if migrated := h.snapshot(); migrated.Version != snapshotVersion || !migrated.valid() {
		t.Fatal("migrated room did not produce a valid version 2 snapshot")
	}
}

func TestV1MigrationRestoresBlockedStarterPort(t *testing.T) {
	const code = "BLOCKD"
	legacy := snapshot{
		Version:       1,
		Width:         12,
		Height:        8,
		Tiles:         make([]savedTile, 12*8),
		LegacyCredits: buildCost[engine.Extractor] + buildCost[engine.Belt] + buildCost[engine.Seller],
		GridTier:      0,
	}

	generated := NewResourceWorld(code)
	offX := (generated.Width() - legacy.Width) / 2
	offY := (generated.Height() - legacy.Height) / 2
	blockedX, blockedY := -1, -1
	for y := 0; y < legacy.Height; y++ {
		for x := 0; x < legacy.Width; x++ {
			if generated.HasPort(offX+x, offY+y) {
				legacy.Tiles[y*legacy.Width+x] = savedTile{K: uint8(engine.Belt), D: uint8(engine.East)}
				blockedX, blockedY = offX+x, offY+y
			}
		}
	}
	if blockedX < 0 || !legacy.valid() {
		t.Fatal("test setup did not block a valid legacy starter port")
	}

	h := hubFromSnapshot(legacy, code)
	if h.world.At(blockedX, blockedY).Kind != engine.Belt {
		t.Fatal("migration replaced the legacy belt that blocked the starter port")
	}
	if h.world.HasPort(blockedX, blockedY) {
		t.Fatal("migration left a shipping port beneath the legacy belt")
	}
	if h.gridTier != 0 {
		t.Fatalf("migration granted grid tier %d, want the saved tier 0", h.gridTier)
	}
	if _, _, _, ok := openRecoveryLine(h); !ok {
		t.Fatal("migrated room needs an open one-belt recovery line")
	}
}

func TestV1MigrationKeepsOneBeltRestartAffordable(t *testing.T) {
	legacy := snapshot{
		Version:       1,
		Width:         12,
		Height:        8,
		Tiles:         make([]savedTile, 12*8),
		LegacyCredits: buildCost[engine.Extractor] + buildCost[engine.Belt] + buildCost[engine.Seller],
		GridTier:      0,
	}
	if !legacy.valid() {
		t.Fatal("test setup is not a valid version 1 save")
	}

	h := hubFromSnapshot(legacy, "RELINE")
	deposit, belt, port, ok := openRecoveryLine(h)
	if !ok {
		t.Fatal("migrated room needs a one-belt recovery line")
	}
	extractorDir, sellerDir := "east", "west"
	if deposit.X > port.X {
		extractorDir, sellerDir = "west", "east"
	}
	if !h.applyPlacements(wire.KindExtractor, []wire.Placement{{X: deposit.X, Y: deposit.Y, Dir: extractorDir}}) ||
		!h.applyPlacements(wire.KindBelt, []wire.Placement{{X: belt.X, Y: belt.Y, Dir: extractorDir}}) ||
		!h.applyPlacements(wire.KindSeller, []wire.Placement{{X: port.X, Y: port.Y, Dir: sellerDir}}) {
		t.Fatal("legacy credits did not cover the recovery line")
	}
	h.recompute()
	if h.credits != 0 || len(h.routes) != 1 || h.currentRate() <= 0 {
		t.Fatalf("recovery line did not produce: credits=%d routes=%d rate=%v", h.credits, len(h.routes), h.currentRate())
	}
	if migrated := h.snapshot(); !migrated.valid() {
		t.Fatal("recovered room did not produce a valid version 2 snapshot")
	}
}

func TestMigrationRecoveryTerrainAddsBothFeatures(t *testing.T) {
	world := engine.NewWorld(resourceWorldSize, resourceWorldSize)
	tier := ensureMigrationRecoveryTerrain(world, 0)
	h := NewHub(world)
	h.gridTier = tier

	if _, _, _, ok := openRecoveryLine(h); !ok {
		t.Fatal("recovery terrain did not add a one-belt line")
	}
}

func TestMigrationRecoveryTerrainUnlocksSpaceWhenNeeded(t *testing.T) {
	world := engine.NewWorld(resourceWorldSize, resourceWorldSize)
	x0, y0, x1, y1 := tierRect(world, 0)
	for y := y0; y <= y1; y++ {
		for x := x0; x <= x1; x++ {
			world.PlaceBelt(x, y, engine.East)
		}
	}

	tier := ensureMigrationRecoveryTerrain(world, 0)
	if tier != 1 {
		t.Fatalf("recovery tier = %d, want 1", tier)
	}
	h := NewHub(world)
	h.gridTier = tier
	if _, _, _, ok := openRecoveryLine(h); !ok {
		t.Fatal("next tier did not provide open recovery terrain")
	}
}

func openRecoveryLine(h *Hub) (deposit, belt, port savedCell, ok bool) {
	var deposits, ports []cell
	x0, y0, x1, y1 := h.unlockedRect()
	for y := y0; y <= y1; y++ {
		for x := x0; x <= x1; x++ {
			if h.world.At(x, y).Kind != engine.Empty {
				continue
			}
			if h.world.DepositAt(x, y).Remaining > 0 {
				deposits = append(deposits, cell{x, y})
			}
			if h.world.HasPort(x, y) {
				ports = append(ports, cell{x, y})
			}
		}
	}
	d, p, ok := oneBeltRecoveryPair(h.world, deposits, ports)
	if !ok {
		return savedCell{}, savedCell{}, savedCell{}, false
	}
	return savedCell{X: d.x, Y: d.y},
		savedCell{X: (d.x + p.x) / 2, Y: d.y},
		savedCell{X: p.x, Y: p.y}, true
}

func TestV2SnapshotRejectsInvalidTerrainRelationships(t *testing.T) {
	base := NewHub(NewResourceWorld("TERRAIN")).snapshot()
	copySnapshot := func() snapshot {
		s := base
		s.Tiles = append([]savedTile(nil), base.Tiles...)
		s.Deposits = append([]savedDeposit(nil), base.Deposits...)
		s.Ports = append([]savedCell(nil), base.Ports...)
		return s
	}

	tests := []struct {
		name   string
		mutate func(*snapshot)
	}{
		{"unknown resource", func(s *snapshot) { s.Deposits[0].K = uint8(engine.Gold) + 1 }},
		{"stock above capacity", func(s *snapshot) { s.Deposits[0].Remaining = s.Deposits[0].Capacity + 1 }},
		{"deposit overlaps port", func(s *snapshot) {
			d := s.Deposits[0]
			s.Ports = append(s.Ports, savedCell{X: d.X, Y: d.Y})
		}},
		{"extractor without deposit", func(s *snapshot) {
			i := 32*s.Width + 32
			s.Tiles[i] = savedTile{K: uint8(engine.Extractor), D: uint8(engine.East)}
			s.Deposits = nil
		}},
		{"seller without port", func(s *snapshot) {
			i := 32*s.Width + 32
			s.Tiles[i] = savedTile{K: uint8(engine.Seller), D: uint8(engine.West)}
			s.Ports = nil
		}},
		{"belt on live deposit", func(s *snapshot) {
			d := s.Deposits[0]
			s.Tiles[d.Y*s.Width+d.X] = savedTile{K: uint8(engine.Belt), D: uint8(engine.East)}
		}},
		{"building outside unlocked land", func(s *snapshot) {
			s.Tiles[0] = savedTile{K: uint8(engine.Belt), D: uint8(engine.East)}
		}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			s := copySnapshot()
			test.mutate(&s)
			if s.valid() {
				t.Fatal("invalid terrain snapshot passed validation")
			}
		})
	}
}

func simulationSaveHub(stock int) *Hub {
	w := engine.NewWorld(resourceWorldSize, resourceWorldSize)
	w.SetDeposit(30, 32, engine.Copper, stock)
	w.SetPort(35, 32, true)
	w.PlaceExtractor(30, 32, engine.East)
	for x := 31; x <= 34; x++ {
		w.PlaceBelt(x, 32, engine.East)
	}
	w.PlaceSeller(35, 32, engine.West)
	h := NewHub(w)
	h.extractorLevel = maxSimLevel + 7
	h.beltLevel = maxSimLevel + 7
	h.valueLevel = 2
	return h
}

func TestSnapshotRestoresActiveRouteAndChunks(t *testing.T) {
	h := simulationSaveHub(4000)
	h.tick()
	snap := h.snapshot()
	if !snap.valid() || len(snap.Routes) != 1 || len(snap.Chunks) == 0 || !snap.Routes[0].Active {
		t.Fatalf("active simulation snapshot is incomplete: routes=%+v chunks=%d", snap.Routes, len(snap.Chunks))
	}

	back := hubFromSnapshot(snap, "ACTIVE")
	key := routeKey(snap.Routes[0].Extractor, snap.Routes[0].Cells)
	for _, c := range back.chunks {
		if c.route != back.routes[key] {
			t.Fatal("restored active chunk does not share its live route pointer")
		}
	}
	for i := 0; i < 10; i++ {
		h.tick()
		back.tick()
	}
	if back.credits != h.credits || back.world.DepositAt(30, 32) != h.world.DepositAt(30, 32) {
		t.Fatal("restored active simulation diverged from the original")
	}
}

func TestSnapshotPreservesChunksAfterSourceIsReplaced(t *testing.T) {
	h := simulationSaveHub(137)
	h.tick()
	if h.world.DepositAt(30, 32).Remaining != 0 || len(h.chunks) == 0 {
		t.Fatal("test setup needs a depleted source with material still in flight")
	}
	h.world.Destroy(30, 32)
	h.world.PlaceBelt(30, 32, engine.East)
	h.recompute()

	saves := newTestSaves(t)
	if err := saves.save("INFLYT", h.snapshot()); err != nil {
		t.Fatalf("save: %v", err)
	}
	snap, ok := saves.load("INFLYT")
	if !ok {
		t.Fatal("save with stale in-flight route did not validate")
	}
	back := hubFromSnapshot(snap, "INFLYT")
	for i := 0; i < 10; i++ {
		h.tick()
		back.tick()
	}
	if back.credits != h.credits {
		t.Fatalf("restart lost in-flight value: got %d credits, want %d", back.credits, h.credits)
	}
	want := startingCredits + 137*rawValue(engine.Copper)*h.saleValueMultiplier()
	if back.credits != want {
		t.Fatalf("depleted deposit produced %d credits after restart, want %d", back.credits, want)
	}
}

func TestSnapshotAllowsLargeLegalChunkSets(t *testing.T) {
	const extraChunk = 1
	chunkCount := resourceWorldSize*resourceWorldSize*subSteps + extraChunk
	h := simulationSaveHub(chunkCount + 1)
	snap := h.snapshot()
	snap.Deposits[0].Remaining = 1
	snap.Chunks = make([]savedChunk, chunkCount)
	for i := range snap.Chunks {
		snap.Chunks[i] = savedChunk{Route: 0, Units: 1}
	}

	if !snap.valid() {
		t.Fatal("legal in-flight material should not be rejected by an arbitrary chunk limit")
	}
}

func TestV2SnapshotRejectsInvalidSimulationState(t *testing.T) {
	h := simulationSaveHub(4000)
	h.tick()
	base := h.snapshot()
	copySnapshot := func() snapshot {
		s := base
		s.Routes = append([]savedRoute(nil), base.Routes...)
		for i := range s.Routes {
			s.Routes[i].Cells = append([]int(nil), base.Routes[i].Cells...)
		}
		s.Chunks = append([]savedChunk(nil), base.Chunks...)
		return s
	}

	tests := []struct {
		name   string
		mutate func(*snapshot)
	}{
		{"route cell out of bounds", func(s *snapshot) { s.Routes[0].Cells[0] = s.Width * s.Height }},
		{"route cells are not contiguous", func(s *snapshot) {
			s.Routes[0].Cells[1] = s.Routes[0].Cells[0] + s.Width + 1
		}},
		{"invalid route resource", func(s *snapshot) { s.Routes[0].Resource = uint8(engine.Gold) + 1 }},
		{"invalid route fraction", func(s *snapshot) { s.Routes[0].UnitPart = 1 }},
		{"chunk route out of bounds", func(s *snapshot) { s.Chunks[0].Route = len(s.Routes) }},
		{"negative chunk distance", func(s *snapshot) { s.Chunks[0].Dist = -1 }},
		{"empty chunk", func(s *snapshot) { s.Chunks[0].Units = 0 }},
		{"unconserved chunk units", func(s *snapshot) { s.Chunks[0].Units = 4001 }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			s := copySnapshot()
			test.mutate(&s)
			if s.valid() {
				t.Fatal("invalid simulation snapshot passed validation")
			}
		})
	}
}

const (
	persistedBeltX = 31
	persistedBeltY = 28
)

func newPersistentTestRooms(t *testing.T) *Rooms {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	return NewRooms(ctx, 20*time.Millisecond, func(code string) *engine.World {
		world := NewResourceWorld(code)
		world.PlaceBelt(persistedBeltX, persistedBeltY, engine.East)
		return world
	}, nil, nil)
}

func TestExpiredRoomComesBackFromDisk(t *testing.T) {
	rs := newPersistentTestRooms(t)
	rs.saves = newTestSaves(t)

	hub, _ := rs.join("AAAAAA")
	// Tear down a belt: the world changes and the purse grows by the refund,
	// giving both halves of the snapshot something to prove.
	client := &Client{send: make(chan []byte, clientBuffer)}
	hub.Register(client)
	hub.Submit(client, wire.Command{Type: wire.CmdDestroy, X: persistedBeltX, Y: persistedBeltY})
	rs.leave("AAAAAA")
	waitTornDown(t, hub)

	back, ok := rs.join("AAAAAA")
	if !ok || back == hub {
		t.Fatal("rejoining after expiry should build a fresh hub")
	}
	if back.world.At(persistedBeltX, persistedBeltY).Kind != engine.Empty {
		t.Fatal("the restored room should remember the torn-down belt")
	}
	if back.credits == startingCredits {
		t.Fatal("the restored room should remember the refund, not start fresh")
	}
}

func TestShutdownSavesEveryRoom(t *testing.T) {
	rs := newPersistentTestRooms(t)
	rs.saves = newTestSaves(t)

	hub, _ := rs.join("AAAAAA")
	client := &Client{send: make(chan []byte, clientBuffer)}
	hub.Register(client)
	hub.Submit(client, wire.Command{Type: wire.CmdDestroy, X: persistedBeltX, Y: persistedBeltY})
	rs.Shutdown()

	snap, ok := rs.saves.load("AAAAAA")
	if !ok {
		t.Fatal("shutdown should leave a save behind")
	}
	i := persistedBeltY*snap.Width + persistedBeltX
	if engine.TileKind(snap.Tiles[i].K) != engine.Empty {
		t.Fatal("the save should carry the torn-down belt")
	}
}
