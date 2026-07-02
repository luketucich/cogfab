package server

import "strconv"

// The ore the client draws and the total the server keeps come from the same idea,
// run on each side: chunks ride the belts at a fixed speed, spaced a fixed gap
// apart, and are tallied when they reach a seller. Keep these in step with
// web/src/world/FlowItems.tsx.
const (
	oreSpeed = 2.5 // belts per second a chunk travels
	oreGap   = 0.5 // belts between chunks; oreSpeed/oreGap = 5 chunks per second
	subSteps = 10  // sim steps per one-second tick, so a chunk never skips a belt
)

// route is one extractor-to-seller path the ore rides: the belts it crosses
// (extractor mouth first, seller mouth last) and the seller cell at the end. Chunks
// point at it, so a path rebuilt unchanged keeps the same route and its chunks keep
// flowing.
type route struct {
	cells  []int
	seller int
}

// chunk is one ore in flight: how far along its route it has travelled, in belts.
type chunk struct {
	route *route
	dist  float64
}

// recompute rebuilds the live routes after a world change, reusing one whose path
// is unchanged so the chunks on it keep flowing. Chunks on a route that is gone
// keep their pointer and drain off on their own.
func (h *Hub) recompute() {
	next := make(map[string]*route)
	for _, p := range h.world.Producers() {
		key := routeKey(p.Path)
		if was, ok := h.routes[key]; ok {
			was.seller = p.Seller
			next[key] = was
		} else {
			next[key] = &route{cells: p.Path, seller: p.Seller}
		}
	}
	h.routes = next
}

// tick advances the ore one second in small steps, tallying every chunk that lands
// in its seller and dropping every chunk whose belt is gone, then tops up each
// route with fresh chunks from its extractor.
func (h *Hub) tick() {
	delivered := 0
	for s := 0; s < subSteps; s++ {
		alive := h.chunks[:0]
		for _, c := range h.chunks {
			c.dist += oreSpeed / subSteps
			cell := int(c.dist)
			if cell >= len(c.route.cells) {
				if h.world.IsSeller(c.route.seller) {
					delivered++ // landed in the seller
				}
				continue // off the end either way
			}
			if !h.world.IsBelt(c.route.cells[cell]) {
				continue // its belt is gone: fell off
			}
			alive = append(alive, c)
		}
		h.chunks = alive
		h.emit()
	}
	h.ironOre += delivered
	h.ratePerSec = delivered // chunks that landed this second
}

// emit adds a chunk at the head of each route once the nearest one has moved a gap
// ahead, so ore fills out from the extractor at the production rate.
func (h *Hub) emit() {
	for _, rt := range h.routes {
		nearest := -1.0
		for _, c := range h.chunks {
			if c.route == rt && (nearest < 0 || c.dist < nearest) {
				nearest = c.dist
			}
		}
		if nearest < 0 || nearest >= oreGap {
			h.chunks = append(h.chunks, &chunk{route: rt})
		}
	}
}

// routeKey identifies a route by its ordered belt cells.
func routeKey(cells []int) string {
	b := make([]byte, 0, len(cells)*4)
	for _, c := range cells {
		b = strconv.AppendInt(b, int64(c), 10)
		b = append(b, ',')
	}
	return string(b)
}
