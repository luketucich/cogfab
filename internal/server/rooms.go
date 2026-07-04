package server

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/luketucich/cogfab/internal/engine"
)

// maxPlayers is how many people one room holds. A player's slot doubles as its
// colour, so this matches PLAYER_COLORS in web/src/ui.ts.
const maxPlayers = 4

// maxRooms caps how many rooms one process hosts at once. Rooms are cheap
// (a goroutine and a few kilobytes), so this is far above real use; it exists
// so a script hammering the endpoint cannot mint goroutines and save files
// without bound. A joiner refused by the cap gets the same full answer as a
// fifth player.
const maxRooms = 1000

// room is one live game: a hub plus the bookkeeping the registry needs. Every
// field here is guarded by Rooms.mu; the hub itself runs on its own goroutine
// and is never touched under the lock.
type room struct {
	hub     *Hub
	cancel  context.CancelFunc // stops the hub's Run loop
	players int                // seats taken: connections admitted and not yet gone
	empty   *time.Timer        // counting down to teardown while players == 0
	gen     int                // bumps whenever the timer changes, so only the current one can expire the room
}

// Rooms is the registry: it hands out rooms by code, caps how many players
// each holds, and tears a room down a grace period after it empties. Lookup is
// the cold path, so one mutex guards it; each room's world stays lock-free on
// its own goroutine, exactly as before.
type Rooms struct {
	ctx      context.Context      // parent of every hub; ends them all on shutdown
	grace    time.Duration        // how long an empty room survives
	newWorld func() *engine.World // main decides what a fresh factory looks like
	saves    *Saves               // rooms restore from and save to here; nil = memory only

	mu    sync.Mutex
	rooms map[string]*room
}

// NewRooms creates an empty registry.
func NewRooms(ctx context.Context, grace time.Duration, newWorld func() *engine.World, saves *Saves) *Rooms {
	return &Rooms{ctx: ctx, grace: grace, newWorld: newWorld, saves: saves, rooms: make(map[string]*room)}
}

// Handler turns each request into a game connection: it reads the room code
// from the URL (minting one when absent or malformed), joins that room, and
// serves the WebSocket against the room's hub. Joining an unknown code creates
// a fresh room under it, so a shared link keeps working forever.
func (rs *Rooms) Handler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		code := strings.ToUpper(r.URL.Query().Get("room"))
		if !validCode(code) {
			code = newCode()
		}
		hub, ok := rs.join(code)
		if !ok {
			refuse(w, r)
			return
		}
		defer rs.leave(code) // after serve's own defers: the hub lets go first
		hub.serve(w, r)
	}
}

// join returns the room's hub, creating the room if the code is new, and takes
// a seat. A new room picks up from its save on disk when it has one, so a
// factory outlives restarts and the empty-room grace. ok is false when the
// room is already full.
func (rs *Rooms) join(code string) (*Hub, bool) {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	rm := rs.rooms[code]
	if rm == nil {
		if len(rs.rooms) >= maxRooms {
			return nil, false
		}
		var hub *Hub
		if snap, ok := rs.saves.load(code); ok {
			hub = hubFromSnapshot(snap)
		} else {
			hub = NewHub(rs.newWorld())
		}
		hub.code = code
		hub.saves = rs.saves
		ctx, cancel := context.WithCancel(rs.ctx)
		go hub.Run(ctx)
		rm = &room{hub: hub, cancel: cancel}
		rs.rooms[code] = rm
	}
	if rm.players == maxPlayers {
		return nil, false
	}
	rm.players++
	if rm.empty != nil {
		rm.empty.Stop() // someone came back: the room is no longer condemned
		rm.empty = nil
		rm.gen++
	}
	return rm.hub, true
}

// leave gives a seat back. The last player out starts the grace timer instead
// of tearing down right away, so a refresh or a short break keeps the factory.
func (rs *Rooms) leave(code string) {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	rm := rs.rooms[code]
	if rm == nil {
		return
	}
	rm.players--
	if rm.players == 0 {
		rm.gen++
		gen := rm.gen
		rm.empty = time.AfterFunc(rs.grace, func() { rs.expire(code, gen) })
	}
}

// expire tears an empty room down once its grace runs out. The checks under
// the lock are the race guard: a joiner who slipped in makes players nonzero,
// and a leave-rejoin-leave makes the generation move on, so a stale timer that
// fired while parked on the mutex does nothing either way. Waiting for the hub
// to finish (it saves on the way out) before dropping the code means a rejoin
// can only ever load the completed save.
func (rs *Rooms) expire(code string, gen int) {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	rm := rs.rooms[code]
	if rm == nil || rm.players > 0 || rm.gen != gen {
		return
	}
	rm.cancel()
	<-rm.hub.done
	delete(rs.rooms, code)
}

// Shutdown waits for every room to save and stop. Call it once the parent
// context is cancelled and the HTTP server no longer accepts joins.
func (rs *Rooms) Shutdown() {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	for _, rm := range rs.rooms {
		rm.cancel()
		<-rm.hub.done
	}
}
