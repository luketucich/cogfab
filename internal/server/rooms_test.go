package server

import (
	"context"
	"testing"
	"time"
)

// newTestRooms is a registry over tiny test worlds with a very short grace, so
// expiry tests run in milliseconds.
func newTestRooms(t *testing.T) *Rooms {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	return NewRooms(ctx, 20*time.Millisecond, newTestWorld)
}

// waitTornDown fails the test unless the hub's Run loop exits soon; the done
// channel makes teardown deterministic to observe, no sleeping and hoping.
func waitTornDown(t *testing.T, hub *Hub) {
	t.Helper()
	select {
	case <-hub.done:
	case <-time.After(2 * time.Second):
		t.Fatal("the room's hub was never torn down")
	}
}

func TestJoinCreatesAndReusesRooms(t *testing.T) {
	rs := newTestRooms(t)

	first, ok := rs.join("AAAAAA")
	if !ok || first == nil {
		t.Fatal("joining a fresh code should create its room")
	}
	same, ok := rs.join("AAAAAA")
	if !ok || same != first {
		t.Fatal("joining the same code should land in the same room")
	}
	other, ok := rs.join("BBBBBB")
	if !ok || other == first {
		t.Fatal("a different code should be a different room")
	}
}

func TestRoomsCapAtFourPlayers(t *testing.T) {
	rs := newTestRooms(t)
	for i := 0; i < maxPlayers; i++ {
		if _, ok := rs.join("AAAAAA"); !ok {
			t.Fatalf("join %d of %d should succeed", i+1, maxPlayers)
		}
	}
	if _, ok := rs.join("AAAAAA"); ok {
		t.Fatal("a fifth join should be refused")
	}

	rs.leave("AAAAAA")
	if _, ok := rs.join("AAAAAA"); !ok {
		t.Fatal("a seat freed by a leave should admit the next join")
	}
}

func TestEmptyRoomExpiresAfterGrace(t *testing.T) {
	rs := newTestRooms(t)
	hub, _ := rs.join("AAAAAA")
	rs.leave("AAAAAA")

	waitTornDown(t, hub)
	fresh, ok := rs.join("AAAAAA")
	if !ok || fresh == hub {
		t.Fatal("joining after expiry should build a fresh room under the code")
	}
}

func TestRejoinWithinGraceKeepsTheRoom(t *testing.T) {
	rs := newTestRooms(t)
	hub, _ := rs.join("AAAAAA")
	rs.leave("AAAAAA")

	same, ok := rs.join("AAAAAA") // back before the grace runs out
	if !ok || same != hub {
		t.Fatal("rejoining within grace should land in the same room")
	}
	time.Sleep(60 * time.Millisecond) // three grace periods
	select {
	case <-hub.done:
		t.Fatal("the stopped grace timer must not tear down an occupied room")
	default:
	}
}
