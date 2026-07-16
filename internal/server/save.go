package server

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"sort"

	"github.com/luketucich/cogfab/internal/engine"
)

// Rooms persist as one small JSON file per room code, so a factory survives
// server restarts and the empty-room grace running out. Periodic and shutdown
// save attempts run on the hub's goroutine, which keeps the no-lock rule intact:
// nothing outside that goroutine reads hub state.

// Version 2 adds the larger world, finite deposits, ports, and credits. Version
// 1 remains readable so deployed rooms migrate instead of resetting.
const snapshotVersion = 2

// snapshot is everything a room needs to resume: grid, terrain, credits,
// upgrades, land, and the material currently travelling on belts.
type snapshot struct {
	Version        int            `json:"version"`
	Width          int            `json:"width"`
	Height         int            `json:"height"`
	Tiles          []savedTile    `json:"tiles"` // row-major, like the engine
	Credits        int            `json:"credits"`
	LegacyCredits  int            `json:"ironOre,omitempty"`
	ExtractorLevel int            `json:"extractorLevel"`
	BeltLevel      int            `json:"beltLevel"`
	ValueLevel     int            `json:"valueLevel"`
	GridTier       int            `json:"gridTier"`
	Deposits       []savedDeposit `json:"deposits,omitempty"`
	Ports          []savedCell    `json:"ports,omitempty"`
	Routes         []savedRoute   `json:"routes,omitempty"`
	Chunks         []savedChunk   `json:"chunks,omitempty"`
}

// savedTile is one grid cell, kind and facing, as the engine's enum values.
type savedTile struct {
	K uint8 `json:"k"`
	D uint8 `json:"d"`
}

type savedDeposit struct {
	X         int   `json:"x"`
	Y         int   `json:"y"`
	K         uint8 `json:"k"`
	Remaining int   `json:"remaining"`
	Capacity  int   `json:"capacity"`
}

type savedCell struct {
	X int `json:"x"`
	Y int `json:"y"`
}

type savedRoute struct {
	Extractor int     `json:"extractor"`
	Seller    int     `json:"seller"`
	Resource  uint8   `json:"resource"`
	Cells     []int   `json:"cells"`
	UnitPart  float64 `json:"unitPart,omitempty"`
	Active    bool    `json:"active,omitempty"`
}

type savedChunk struct {
	Route int     `json:"route"`
	Dist  float64 `json:"dist"`
	Units int     `json:"units"`
}

// valid reports whether decoded save data can become live room state.
func (s snapshot) valid() bool {
	if s.Version == 1 {
		return s.validV1()
	}
	if s.Version != snapshotVersion ||
		s.Width != resourceWorldSize || s.Height != resourceWorldSize ||
		len(s.Tiles) != s.Width*s.Height ||
		s.Credits < 0 ||
		s.ExtractorLevel < 0 || s.BeltLevel < 0 || s.ValueLevel < 0 ||
		s.GridTier < 0 || s.GridTier >= len(gridTiers) {
		return false
	}
	for _, tile := range s.Tiles {
		if engine.TileKind(tile.K) > engine.Seller || engine.Direction(tile.D) > engine.West {
			return false
		}
	}
	tier := gridTiers[s.GridTier]
	x0, y0 := (s.Width-tier.w)/2, (s.Height-tier.h)/2
	x1, y1 := x0+tier.w-1, y0+tier.h-1
	for i, tile := range s.Tiles {
		x, y := i%s.Width, i/s.Width
		if engine.TileKind(tile.K) != engine.Empty && (x < x0 || x > x1 || y < y0 || y > y1) {
			return false
		}
	}
	features := make(map[int]uint8, len(s.Deposits)+len(s.Ports))
	depositRemaining := make(map[int]int, len(s.Deposits))
	depositsByCell := make(map[int]savedDeposit, len(s.Deposits))
	for _, deposit := range s.Deposits {
		if deposit.X < 0 || deposit.X >= s.Width || deposit.Y < 0 || deposit.Y >= s.Height ||
			engine.ResourceKind(deposit.K) <= engine.NoResource || engine.ResourceKind(deposit.K) > engine.Gold ||
			deposit.Remaining < 0 || deposit.Capacity <= 0 || deposit.Remaining > deposit.Capacity {
			return false
		}
		cell := deposit.Y*s.Width + deposit.X
		if features[cell] != 0 {
			return false
		}
		features[cell] = 1
		depositRemaining[cell] = deposit.Remaining
		depositsByCell[cell] = deposit
	}
	for _, port := range s.Ports {
		if port.X < 0 || port.X >= s.Width || port.Y < 0 || port.Y >= s.Height {
			return false
		}
		cell := port.Y*s.Width + port.X
		if features[cell] != 0 {
			return false
		}
		features[cell] = 2
	}
	for i, tile := range s.Tiles {
		switch engine.TileKind(tile.K) {
		case engine.Extractor:
			if features[i] != 1 {
				return false
			}
		case engine.Seller:
			if features[i] != 2 {
				return false
			}
		case engine.Belt:
			if features[i] == 2 {
				return false
			}
			if depositRemaining[i] > 0 {
				return false
			}
		}
	}
	return s.validSimulation(depositsByCell)
}

func (s snapshot) validSimulation(deposits map[int]savedDeposit) bool {
	total := s.Width * s.Height
	if len(s.Routes) > total+len(s.Chunks) {
		return false
	}

	world := s.world()
	expectedActive := make(map[string]savedRoute)
	for _, producer := range world.Producers() {
		deposit := world.DepositAt(producer.Cell%world.Width(), producer.Cell/world.Width())
		if deposit.Remaining == 0 {
			continue
		}
		expectedActive[routeKey(producer.Cell, producer.Path)] = savedRoute{
			Seller: producer.Seller, Resource: uint8(deposit.Kind),
		}
	}

	seenActive := make(map[string]bool, len(expectedActive))
	for _, route := range s.Routes {
		if route.Extractor < 0 || route.Extractor >= total ||
			route.Seller < 0 || route.Seller >= total ||
			engine.ResourceKind(route.Resource) <= engine.NoResource || engine.ResourceKind(route.Resource) > engine.Gold ||
			len(route.Cells) == 0 || len(route.Cells) > total ||
			math.IsNaN(route.UnitPart) || math.IsInf(route.UnitPart, 0) || route.UnitPart < 0 || route.UnitPart >= 1 {
			return false
		}
		deposit, ok := deposits[route.Extractor]
		if !ok || deposit.K != route.Resource {
			return false
		}
		seenCells := make(map[int]bool, len(route.Cells))
		previous := route.Extractor
		for _, cell := range route.Cells {
			if cell < 0 || cell >= total || seenCells[cell] || !adjacentCells(previous, cell, s.Width) {
				return false
			}
			seenCells[cell] = true
			previous = cell
		}
		if !adjacentCells(previous, route.Seller, s.Width) {
			return false
		}
		if route.Active {
			key := routeKey(route.Extractor, route.Cells)
			expected, ok := expectedActive[key]
			if !ok || seenActive[key] || expected.Seller != route.Seller || expected.Resource != route.Resource {
				return false
			}
			seenActive[key] = true
		}
	}
	if len(seenActive) != len(expectedActive) {
		return false
	}

	inFlight := make(map[int]int)
	referencedRoutes := make([]bool, len(s.Routes))
	for _, chunk := range s.Chunks {
		if chunk.Route < 0 || chunk.Route >= len(s.Routes) || chunk.Units <= 0 ||
			math.IsNaN(chunk.Dist) || math.IsInf(chunk.Dist, 0) || chunk.Dist < 0 ||
			chunk.Dist >= float64(len(s.Routes[chunk.Route].Cells)) {
			return false
		}
		route := s.Routes[chunk.Route]
		referencedRoutes[chunk.Route] = true
		deposit := deposits[route.Extractor]
		available := deposit.Capacity - deposit.Remaining - inFlight[route.Extractor]
		if chunk.Units > available {
			return false
		}
		inFlight[route.Extractor] += chunk.Units
	}
	for i, route := range s.Routes {
		if !route.Active && !referencedRoutes[i] {
			return false
		}
	}
	return true
}

func adjacentCells(a, b, width int) bool {
	ax, ay := a%width, a/width
	bx, by := b%width, b/width
	return abs(ax-bx)+abs(ay-by) == 1
}

func (s snapshot) validV1() bool {
	if s.Width <= 0 || s.Width > 12 || s.Height <= 0 || s.Height > 8 ||
		len(s.Tiles) != s.Width*s.Height || s.LegacyCredits < 0 ||
		s.ExtractorLevel < 0 || s.BeltLevel < 0 || s.ValueLevel < 0 ||
		s.GridTier < 0 || s.GridTier > 4 {
		return false
	}
	for _, tile := range s.Tiles {
		if engine.TileKind(tile.K) > engine.Seller || engine.Direction(tile.D) > engine.West {
			return false
		}
	}
	return true
}

// snapshot captures the hub's saveable state. Run-goroutine only.
func (h *Hub) snapshot() snapshot {
	width, height := h.world.Width(), h.world.Height()
	tiles := make([]savedTile, 0, width*height)
	var deposits []savedDeposit
	var ports []savedCell
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			t := h.world.At(x, y)
			tiles = append(tiles, savedTile{K: uint8(t.Kind), D: uint8(t.Dir)})
			if d := h.world.DepositAt(x, y); d.Kind != engine.NoResource {
				deposits = append(deposits, savedDeposit{
					X: x, Y: y, K: uint8(d.Kind), Remaining: d.Remaining, Capacity: d.Capacity,
				})
			}
			if h.world.HasPort(x, y) {
				ports = append(ports, savedCell{X: x, Y: y})
			}
		}
	}
	routes, chunks := h.simulationSnapshot()
	return snapshot{
		Version:        snapshotVersion,
		Width:          width,
		Height:         height,
		Tiles:          tiles,
		Credits:        h.credits,
		ExtractorLevel: h.extractorLevel,
		BeltLevel:      h.beltLevel,
		ValueLevel:     h.valueLevel,
		GridTier:       h.gridTier,
		Deposits:       deposits,
		Ports:          ports,
		Routes:         routes,
		Chunks:         chunks,
	}
}

func (h *Hub) simulationSnapshot() ([]savedRoute, []savedChunk) {
	indices := make(map[*route]int, len(h.routes))
	routes := make([]savedRoute, 0, len(h.routes))
	addRoute := func(rt *route, active bool) int {
		if i, ok := indices[rt]; ok {
			return i
		}
		i := len(routes)
		indices[rt] = i
		routes = append(routes, savedRoute{
			Extractor: rt.extractor,
			Seller:    rt.seller,
			Resource:  uint8(rt.resource),
			Cells:     append([]int(nil), rt.cells...),
			UnitPart:  rt.unitPart,
			Active:    active,
		})
		return i
	}

	keys := make([]string, 0, len(h.routes))
	for key := range h.routes {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		addRoute(h.routes[key], true)
	}

	chunks := make([]savedChunk, 0, len(h.chunks))
	for _, c := range h.chunks {
		chunks = append(chunks, savedChunk{
			Route: addRoute(c.route, false), Dist: c.dist, Units: c.units,
		})
	}
	return routes, chunks
}

// world rebuilds the factory grid a snapshot describes.
func (s snapshot) world() *engine.World {
	w := engine.NewWorld(s.Width, s.Height)
	for i, t := range s.Tiles {
		x, y := i%s.Width, i/s.Width
		dir := engine.Direction(t.D)
		switch engine.TileKind(t.K) {
		case engine.Belt:
			w.PlaceBelt(x, y, dir)
		case engine.Extractor:
			w.PlaceExtractor(x, y, dir)
		case engine.Seller:
			w.PlaceSeller(x, y, dir)
		}
	}
	for _, deposit := range s.Deposits {
		w.RestoreDeposit(
			deposit.X, deposit.Y, engine.ResourceKind(deposit.K), deposit.Remaining, deposit.Capacity,
		)
	}
	for _, port := range s.Ports {
		w.SetPort(port.X, port.Y, true)
	}
	return w
}

// hubFromSnapshot is a hub picking up where a saved room left off.
func hubFromSnapshot(s snapshot, code string) *Hub {
	if s.Version == 1 {
		return migrateV1Snapshot(s, code)
	}
	h := NewHub(s.world())
	h.credits = s.Credits
	h.extractorLevel = s.ExtractorLevel
	h.beltLevel = s.BeltLevel
	h.valueLevel = s.ValueLevel
	h.gridTier = s.GridTier
	h.restoreSimulation(s)
	return h
}

func (h *Hub) restoreSimulation(s snapshot) {
	routes := make([]*route, len(s.Routes))
	for i, saved := range s.Routes {
		key := routeKey(saved.Extractor, saved.Cells)
		current := h.routes[key]
		if saved.Active && current != nil && current.seller == saved.Seller && uint8(current.resource) == saved.Resource {
			current.unitPart = saved.UnitPart
			routes[i] = current
			continue
		}
		routes[i] = &route{
			cells:     append([]int(nil), saved.Cells...),
			extractor: saved.Extractor,
			seller:    saved.Seller,
			resource:  engine.ResourceKind(saved.Resource),
			unitPart:  saved.UnitPart,
		}
	}
	for _, saved := range s.Chunks {
		h.chunks = append(h.chunks, &chunk{
			route: routes[saved.Route], dist: saved.Dist, units: saved.Units,
		})
	}
}

func migrateV1Snapshot(s snapshot, code string) *Hub {
	world := NewResourceWorld(code)
	offX := (world.Width() - s.Width) / 2
	offY := (world.Height() - s.Height) / 2
	for i, tile := range s.Tiles {
		x, y := offX+i%s.Width, offY+i/s.Width
		dir := engine.Direction(tile.D)
		switch engine.TileKind(tile.K) {
		case engine.Belt:
			world.SetDeposit(x, y, engine.NoResource, 0)
			world.SetPort(x, y, false)
			world.PlaceBelt(x, y, dir)
		case engine.Extractor:
			world.SetPort(x, y, false)
			world.SetDeposit(x, y, engine.Iron, 4000)
			world.PlaceExtractor(x, y, dir)
		case engine.Seller:
			world.SetDeposit(x, y, engine.NoResource, 0)
			world.SetPort(x, y, true)
			world.PlaceSeller(x, y, dir)
		}
	}
	gridTier := migrationGridTier(world, min(s.GridTier, len(gridTiers)-1))
	gridTier = ensureMigrationRecoveryTerrain(world, gridTier)
	h := NewHub(world)
	h.credits = s.LegacyCredits
	h.extractorLevel = s.ExtractorLevel
	h.beltLevel = s.BeltLevel
	h.valueLevel = s.ValueLevel
	h.gridTier = gridTier
	return h
}

// Older saves allowed buildings outside their reported tier. Preserve those
// accepted rooms by unlocking only enough land to contain the actual factory.
func migrationGridTier(world *engine.World, tier int) int {
	for tier < len(gridTiers)-1 {
		x0, y0, x1, y1 := tierRect(world, tier)
		containsFactory := true
		for y := 0; y < world.Height() && containsFactory; y++ {
			for x := 0; x < world.Width(); x++ {
				if world.At(x, y).Kind != engine.Empty && (x < x0 || x > x1 || y < y0 || y > y1) {
					containsFactory = false
					break
				}
			}
		}
		if containsFactory {
			break
		}
		tier++
	}
	return tier
}

// A version 1 room can be liquidated to 160 credits. Keep an open one-belt
// route available so that amount can always restart production.
func ensureMigrationRecoveryTerrain(world *engine.World, tier int) int {
	for {
		x0, y0, x1, y1 := tierRect(world, tier)
		var deposits, ports, openCells []cell
		for y := y0; y <= y1; y++ {
			for x := x0; x <= x1; x++ {
				if world.At(x, y).Kind != engine.Empty {
					continue
				}
				deposit := world.DepositAt(x, y)
				switch {
				case deposit.Remaining > 0:
					deposits = append(deposits, cell{x, y})
				case world.HasPort(x, y):
					ports = append(ports, cell{x, y})
				case deposit.Kind == engine.NoResource:
					openCells = append(openCells, cell{x, y})
				}
			}
		}

		if _, _, ok := oneBeltRecoveryPair(world, deposits, ports); ok {
			return tier
		}
		if _, port, ok := oneBeltRecoveryPair(world, deposits, openCells); ok {
			world.SetPort(port.x, port.y, true)
			return tier
		}
		if deposit, _, ok := oneBeltRecoveryPair(world, openCells, ports); ok {
			world.SetDeposit(deposit.x, deposit.y, engine.Iron, 4000)
			return tier
		}
		if deposit, port, ok := oneBeltRecoveryPair(world, openCells, openCells); ok {
			world.SetDeposit(deposit.x, deposit.y, engine.Iron, 4000)
			world.SetPort(port.x, port.y, true)
			return tier
		}
		if tier == len(gridTiers)-1 {
			panic("migrated room has no space for recovery terrain")
		}
		tier++
	}
}

func oneBeltRecoveryPair(world *engine.World, deposits, ports []cell) (cell, cell, bool) {
	for _, deposit := range deposits {
		for _, port := range ports {
			if deposit.y != port.y || abs(deposit.x-port.x) != 2 {
				continue
			}
			beltX := (deposit.x + port.x) / 2
			beltDeposit := world.DepositAt(beltX, deposit.y)
			if world.At(beltX, deposit.y).Kind == engine.Empty &&
				!world.HasPort(beltX, deposit.y) && beltDeposit.Kind == engine.NoResource {
				return deposit, port, true
			}
		}
	}
	return cell{}, cell{}, false
}

// Saves is the on-disk store, one file per room code. A nil *Saves is a valid
// store that keeps nothing, so tests and a server without a writable disk just
// run without saving.
type Saves struct {
	dir string
}

// NewSaves opens (creating if needed) the directory room saves live in.
func NewSaves(dir string) (*Saves, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	return &Saves{dir: dir}, nil
}

// path is the save file for a code. Codes are uppercase letters and digits
// (validCode), so they are safe as file names.
func (s *Saves) path(code string) string {
	return filepath.Join(s.dir, code+".json")
}

// save writes a room's snapshot: to a temp file first, then an atomic rename,
// so a crash mid-write can never leave a half-written room behind.
func (s *Saves) save(code string, snap snapshot) error {
	if s == nil {
		return nil
	}
	b, err := json.Marshal(snap)
	if err != nil {
		return err
	}
	tmp := s.path(code) + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path(code))
}

// load reads a room's save, reporting ok = false when there is none worth
// restoring: no file, unreadable JSON, or state outside the game's bounds.
func (s *Saves) load(code string) (snapshot, bool) {
	if s == nil {
		return snapshot{}, false
	}
	b, err := os.ReadFile(s.path(code))
	if err != nil {
		return snapshot{}, false
	}
	var snap snapshot
	if json.Unmarshal(b, &snap) != nil || !snap.valid() {
		return snapshot{}, false
	}
	return snap, true
}
