package server

import (
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/luketucich/cogfab/internal/engine"
)

// Rooms persist as one small JSON file per room code, so a factory survives
// server restarts and the empty-room grace running out. Periodic and shutdown
// save attempts run on the hub's goroutine, which keeps the no-lock rule intact:
// nothing outside that goroutine reads hub state.

// snapshotVersion marks the save layout. A file from another version is
// ignored and the room starts fresh, which beats guessing at old fields.
const snapshotVersion = 1

// snapshot is everything a room needs to come back: the grid and the shared
// purse, levels, and land. Ore in flight is omitted; production resumes on the
// next tick.
type snapshot struct {
	Version        int         `json:"version"`
	Width          int         `json:"width"`
	Height         int         `json:"height"`
	Tiles          []savedTile `json:"tiles"` // row-major, like the engine
	IronOre        int         `json:"ironOre"`
	ExtractorLevel int         `json:"extractorLevel"`
	BeltLevel      int         `json:"beltLevel"`
	ValueLevel     int         `json:"valueLevel"`
	GridTier       int         `json:"gridTier"`
}

// savedTile is one grid cell, kind and facing, as the engine's enum values.
type savedTile struct {
	K uint8 `json:"k"`
	D uint8 `json:"d"`
}

// snapshot captures the hub's saveable state. Run-goroutine only.
func (h *Hub) snapshot() snapshot {
	width, height := h.world.Width(), h.world.Height()
	tiles := make([]savedTile, 0, width*height)
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			t := h.world.At(x, y)
			tiles = append(tiles, savedTile{K: uint8(t.Kind), D: uint8(t.Dir)})
		}
	}
	return snapshot{
		Version:        snapshotVersion,
		Width:          width,
		Height:         height,
		Tiles:          tiles,
		IronOre:        h.ironOre,
		ExtractorLevel: h.extractorLevel,
		BeltLevel:      h.beltLevel,
		ValueLevel:     h.valueLevel,
		GridTier:       h.gridTier,
	}
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
	return w
}

// hubFromSnapshot is a hub picking up where a saved room left off.
func hubFromSnapshot(s snapshot) *Hub {
	h := NewHub(s.world())
	h.ironOre = s.IronOre
	h.extractorLevel = s.ExtractorLevel
	h.beltLevel = s.BeltLevel
	h.valueLevel = s.ValueLevel
	h.gridTier = s.GridTier
	return h
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
// restoring: no file, unreadable JSON, another snapshot version, or a grid
// that does not add up.
func (s *Saves) load(code string) (snapshot, bool) {
	if s == nil {
		return snapshot{}, false
	}
	b, err := os.ReadFile(s.path(code))
	if err != nil {
		return snapshot{}, false
	}
	var snap snapshot
	if json.Unmarshal(b, &snap) != nil || snap.Version != snapshotVersion ||
		snap.Width <= 0 || snap.Height <= 0 || len(snap.Tiles) != snap.Width*snap.Height {
		return snapshot{}, false
	}
	return snap, true
}
