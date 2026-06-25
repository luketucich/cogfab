package engine

import "testing"

func TestDirectionString(t *testing.T) {
	cases := []struct {
		d    Direction
		want string
	}{
		{North, "north"},
		{East, "east"},
		{South, "south"},
		{West, "west"},
	}
	for _, c := range cases {
		if got := c.d.String(); got != c.want {
			t.Errorf("Direction(%d).String() = %q, want %q", c.d, got, c.want)
		}
	}
}

func TestTileKindString(t *testing.T) {
	cases := []struct {
		k    TileKind
		want string
	}{
		{Empty, "empty"},
		{Belt, "belt"},
		{Extractor, "extractor"},
	}
	for _, c := range cases {
		if got := c.k.String(); got != c.want {
			t.Errorf("TileKind(%d).String() = %q, want %q", c.k, got, c.want)
		}
	}
}
