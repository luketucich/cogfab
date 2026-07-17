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

	msg := Snapshot(w, 0, 0, 2, 0)

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
	b, err := json.Marshal(Snapshot(engine.NewWorld(1, 1), 0, 0, 0, 0))
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	for _, key := range []string{`"type"`, `"width"`, `"height"`, `"tiles"`, `"deposits"`, `"ports"`, `"kind"`, `"dir"`} {
		if !strings.Contains(s, key) {
			t.Errorf("JSON missing key %s in: %s", key, s)
		}
	}
	for _, emptyList := range []string{`"deposits":[]`, `"ports":[]`} {
		if !strings.Contains(s, emptyList) {
			t.Errorf("empty sparse terrain must encode as [] in: %s", s)
		}
	}
}

func TestSnapshotOnlyRevealsUnlockedTerrain(t *testing.T) {
	w := engine.NewWorld(3, 2)
	w.SetDeposit(0, 0, engine.Iron, 3000)
	w.SetDeposit(2, 1, engine.Gold, 500)
	w.SetPort(1, 0, true)
	w.SetPort(2, 1, true)

	msg := Snapshot(w, 0, 0, 1, 0)
	if len(msg.Deposits) != 1 || msg.Deposits[0].Kind != "iron" {
		t.Fatalf("visible deposits = %+v, want only iron", msg.Deposits)
	}
	if len(msg.Ports) != 1 || msg.Ports[0] != (CellView{X: 1, Y: 0}) {
		t.Fatalf("visible ports = %+v, want only (1,0)", msg.Ports)
	}
}

func TestTileUpdatesReadAuthoritativeWorldState(t *testing.T) {
	w := engine.NewWorld(3, 1)
	w.PlaceBelt(0, 0, engine.East)
	w.PlaceSeller(1, 0, engine.West)

	msg := TileUpdates(w, []Placement{
		{X: 0, Y: 0, Dir: "north"}, // command direction must not leak into the result
		{X: 1, Y: 0},
		{X: 3, Y: 0}, // unsafe input is ignored instead of reaching World.At
	})

	if msg.Type != "tiles" || len(msg.Tiles) != 2 {
		t.Fatalf("tile update = %+v, want two in-bounds tiles", msg)
	}
	if got, want := msg.Tiles[0], (TileUpdate{X: 0, Y: 0, Kind: "belt", Dir: "east"}); got != want {
		t.Errorf("Tiles[0] = %+v, want %+v", got, want)
	}
	if got, want := msg.Tiles[1], (TileUpdate{X: 1, Y: 0, Kind: "seller", Dir: "west"}); got != want {
		t.Errorf("Tiles[1] = %+v, want %+v", got, want)
	}
}

func TestEmptyTileUpdatesUseAnArray(t *testing.T) {
	b, err := json.Marshal(TileUpdates(engine.NewWorld(1, 1), nil))
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != `{"type":"tiles","tiles":[]}` {
		t.Fatalf("empty tile update encoded as %s", b)
	}
}

func TestResourcesCarriesCurrentStock(t *testing.T) {
	w := engine.NewWorld(2, 1)
	w.SetDeposit(0, 0, engine.Quartz, 900)
	w.Consume(0, 0, 125)

	msg := Resources(w, 0, 0, 1, 0)
	if msg.Type != "resources" || len(msg.Deposits) != 1 {
		t.Fatalf("resources message = %+v", msg)
	}
	if got := msg.Deposits[0]; got.Kind != "quartz" || got.Remaining != 775 || got.Capacity != 900 {
		t.Fatalf("deposit update = %+v, want quartz at 775/900", got)
	}
}

func TestEmptyResourcesUsesAnArray(t *testing.T) {
	b, err := json.Marshal(Resources(engine.NewWorld(1, 1), 0, 0, 0, 0))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"deposits":[]`) {
		t.Fatalf("empty resources encoded as %s, want deposits []", b)
	}
}

func TestPlaceBatchCommandJSON(t *testing.T) {
	var cmd Command
	err := json.Unmarshal([]byte(`{
		"type":"placeBatch",
		"kind":"extractor",
		"placements":[
			{"x":1,"y":2,"dir":"east"},
			{"x":2,"y":2,"dir":"south"}
		]
	}`), &cmd)
	if err != nil {
		t.Fatal(err)
	}
	if cmd.Type != CmdPlaceBatch || cmd.Kind != KindExtractor || len(cmd.Placements) != 2 {
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
				Placements: []Placement{{X: 4, Y: 2, Dir: "west"}},
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

func TestCompactPresenceJSON(t *testing.T) {
	cursor, err := json.Marshal(CursorMessage{
		Type: "cursor", Slot: 2, On: true, SX: 0.25, SY: 0.75,
		Hovering: true, X: 4.5, Y: 3.5,
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`"type":"cursor"`, `"slot":2`, `"sx":0.25`, `"x":4.5`} {
		if !strings.Contains(string(cursor), want) {
			t.Errorf("cursor JSON %s does not contain %s", cursor, want)
		}
	}

	preview, err := json.Marshal(BuildPreviewMessage{Type: "buildPreview", Slot: 2})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(preview), `{"type":"buildPreview","slot":2,"preview":null}`; got != want {
		t.Fatalf("preview clear JSON = %s, want %s", got, want)
	}
}
