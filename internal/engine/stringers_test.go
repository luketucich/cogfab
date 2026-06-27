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
		{Seller, "seller"},
	}
	for _, c := range cases {
		if got := c.k.String(); got != c.want {
			t.Errorf("TileKind(%d).String() = %q, want %q", c.k, got, c.want)
		}
	}
}

func TestParseDirectionRoundTrips(t *testing.T) {
	for _, d := range []Direction{North, East, South, West} {
		if got := ParseDirection(d.String()); got != d {
			t.Errorf("ParseDirection(%q) = %v, want %v", d.String(), got, d)
		}
	}
	if got := ParseDirection("nonsense"); got != North {
		t.Errorf("ParseDirection(unknown) = %v, want North", got)
	}
}
