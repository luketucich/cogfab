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

func TestBeltStrokeCommandJSON(t *testing.T) {
	var cmd Command
	err := json.Unmarshal([]byte(`{
		"type":"beltStroke",
		"placements":[
			{"x":1,"y":2,"dir":"east"},
			{"x":2,"y":2,"dir":"south"}
		]
	}`), &cmd)
	if err != nil {
		t.Fatal(err)
	}
	if cmd.Type != CmdBeltStroke || len(cmd.Placements) != 2 {
		t.Fatalf("decoded command = %+v", cmd)
	}
	if got := cmd.Placements[1]; got.X != 2 || got.Y != 2 || got.Dir != "south" {
		t.Fatalf("second placement = %+v, want (2,2) south", got)
	}
}

func TestPresenceBuildPreviewJSON(t *testing.T) {
	msg := PresenceMessage{
		Type: "presence",
		Players: []PresencePlayer{{
			Slot: 1,
			Preview: &BuildPreview{
				Kind:       KindSeller,
				Placements: []BeltPlacement{{X: 4, Y: 2, Dir: "west"}},
			},
		}},
	}
	b, err := json.Marshal(msg)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`"preview"`, `"kind":"seller"`, `"dir":"west"`} {
		if !strings.Contains(string(b), want) {
			t.Errorf("presence JSON %s does not contain %s", b, want)
		}
	}
}
