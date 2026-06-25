package wire

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/luketucich/cogfab/internal/engine"
)

func TestSnapshotCapturesGrid(t *testing.T) {
	w := engine.NewWorld(3, 1)
	w.PlaceExtractor(0, 0, engine.East)
	w.PlaceBelt(1, 0, engine.East)
	// (2,0) stays empty

	msg := Snapshot(w)

	if msg.Type != "state" {
		t.Errorf("Type = %q, want %q", msg.Type, "state")
	}
	if msg.Width != 3 || msg.Height != 1 {
		t.Errorf("size = %dx%d, want 3x1", msg.Width, msg.Height)
	}
	if len(msg.Tiles) != 3 {
		t.Fatalf("len(Tiles) = %d, want 3", len(msg.Tiles))
	}
	if got, want := msg.Tiles[0], (TileView{Kind: "extractor", Dir: "east"}); got != want {
		t.Errorf("Tiles[0] = %+v, want %+v", got, want)
	}
	if got, want := msg.Tiles[1], (TileView{Kind: "belt", Dir: "east"}); got != want {
		t.Errorf("Tiles[1] = %+v, want %+v", got, want)
	}
	if msg.Tiles[2].Kind != "empty" {
		t.Errorf("Tiles[2].Kind = %q, want empty", msg.Tiles[2].Kind)
	}
}

func TestSnapshotJSONHasExpectedKeys(t *testing.T) {
	b, err := json.Marshal(Snapshot(engine.NewWorld(1, 1)))
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	for _, key := range []string{`"type"`, `"width"`, `"height"`, `"tiles"`, `"kind"`, `"dir"`} {
		if !strings.Contains(s, key) {
			t.Errorf("JSON missing key %s in: %s", key, s)
		}
	}
}
