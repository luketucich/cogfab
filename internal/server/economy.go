package server

import "strconv"

// The ore the client draws and the total the server keeps come from the same
// idea, run on each side: chunks ride the belts at a shared speed, spaced a
// shared gap apart, and are tallied when they reach a seller. The constants are
// mirrored in web/src/world/economy.ts and the emission logic in
// web/src/world/FlowItems.tsx; keep them in step.
const (
	oreSpeed = 2.5 // belts per second a chunk travels, before Belt Speed levels
	oreGap   = 0.5 // belts between chunks; oreSpeed/oreGap = 5 chunks per second

	// subSteps is the sim steps per one-second tick: enough that a chunk never
	// skips a belt, with room to emit one chunk per step at the sim cap (~39/sec).
	subSteps = 40
)

// extractorMult and beltMult are the level multipliers the two rate upgrades
// apply: each Extractor Rate level adds half the base emission rate, each Belt
// Speed level a quarter of the base speed. Everything that moves or prices ore
// derives from these two. Keep in step with economy.ts.
func extractorMult(level int) float64 { return 1 + 0.5*float64(level) }
func beltMult(level int) float64      { return 1 + 0.25*float64(level) }

// maxSimLevel is where the simulation stops getting busier: past this the
// belts are visually maxed out, and each further level pays through richer
// chunks instead (see chunkValue), so the sim stays bounded while the levels
// climb forever. Keep in step with MAX_SIM_LEVEL in economy.ts.
const maxSimLevel = 5

// emitGap is how close together chunks leave the extractors, capped at the sim
// cap. Keep in step with FlowItems.tsx.
func (h *Hub) emitGap() float64 {
	return oreGap / extractorMult(min(h.extractorLevel, maxSimLevel))
}

// beltSpeed is how fast chunks travel, capped at the sim cap. Faster belts
// also deliver more often at the same spacing.
func (h *Hub) beltSpeed() float64 {
	return oreSpeed * beltMult(min(h.beltLevel, maxSimLevel))
}

// oreValue is what one delivery is worth: the base ore plus one for each Ore
// Value level. Keep in step with oreValue in economy.ts.
func (h *Hub) oreValue() float64 {
	return 1 + float64(h.valueLevel)
}

// chunkValue is the ore one landing chunk pays. Normally just oreValue, but
// once Extractor Rate or Belt Speed pass the sim cap the belts cannot visibly
// carry more, so the extra multiplier rides along on each chunk instead.
func (h *Hub) chunkValue() float64 {
	v := h.oreValue()
	if h.extractorLevel > maxSimLevel {
		v *= extractorMult(h.extractorLevel) / extractorMult(maxSimLevel)
	}
	if h.beltLevel > maxSimLevel {
		v *= beltMult(h.beltLevel) / beltMult(maxSimLevel)
	}
	return v
}

// currentRate is what the factory produces per second right now: every route
// carries its chunks-per-second, each delivery worth oreValue, with no sim cap
// applied (the cap only shapes the visuals; chunkValue makes up the rest).
// Derived from the routes instead of measured, so the HUD reads steady instead
// of flickering with the sub-second timing of individual deliveries.
func (h *Hub) currentRate() float64 {
	chunksPerSec := oreSpeed * beltMult(h.beltLevel) / (oreGap / extractorMult(h.extractorLevel))
	return float64(len(h.routes)) * chunksPerSec * h.oreValue()
}

// route is one extractor-to-seller path the ore rides: the belts it crosses
// (extractor mouth first, seller mouth last) and the seller cell at the end. Chunks
// point at it, so a path rebuilt unchanged keeps the same route and its chunks keep
// flowing.
type route struct {
	cells   []int
	seller  int
	nearest float64 // scratch: the closest chunk to the extractor this sub-step, for emit
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
		key := routeKey(p.Cell, p.Path)
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
// route with fresh chunks from its extractor. Every stream that reaches a seller
// pays, so each extractor you connect adds a full line of income.
func (h *Hub) tick() {
	earned := 0.0
	speed := h.beltSpeed()
	value := h.chunkValue()
	for s := 0; s < subSteps; s++ {
		for _, rt := range h.routes {
			rt.nearest = -1
		}
		alive := h.chunks[:0]
		for _, c := range h.chunks {
			c.dist += speed / subSteps
			cell := int(c.dist)
			if cell >= len(c.route.cells) {
				if h.world.IsSeller(c.route.seller) {
					earned += value // landed in the seller
				}
				continue // off the end either way
			}
			if !h.world.IsBelt(c.route.cells[cell]) {
				continue // its belt is gone: fell off
			}
			if c.route.nearest < 0 || c.dist < c.route.nearest {
				c.route.nearest = c.dist // noted in passing, so emit never rescans
			}
			alive = append(alive, c)
		}
		h.chunks = alive
		h.emit()
	}
	// Chunk values go fractional past the sim cap; bank the whole ore and
	// carry the remainder into the next second so nothing is ever lost.
	h.orePartial += earned
	whole := int(h.orePartial)
	h.ironOre += whole
	h.orePartial -= float64(whole)
}

// emit adds a chunk at the head of each route once the nearest one has moved a
// gap ahead, reading the nearest the advance pass already noted (a rescan here
// went quadratic on big boards). The new chunk starts at the overshoot past the
// gap, not at zero, so no spacing is lost between steps and the long-run rate
// is exactly beltSpeed/emitGap at every level.
func (h *Hub) emit() {
	gap := h.emitGap()
	for _, rt := range h.routes {
		if rt.nearest < 0 {
			h.chunks = append(h.chunks, &chunk{route: rt})
		} else if rt.nearest >= gap {
			h.chunks = append(h.chunks, &chunk{route: rt, dist: rt.nearest - gap})
		}
	}
}

// routeKey identifies a route by the extractor it starts from and its ordered
// belt cells. The extractor matters: two extractors feeding the same mouth belt
// are two paying streams and must stay two routes, just as the client draws them.
func routeKey(extractor int, cells []int) string {
	b := make([]byte, 0, (len(cells)+1)*4)
	b = strconv.AppendInt(b, int64(extractor), 10)
	b = append(b, ':')
	for _, c := range cells {
		b = strconv.AppendInt(b, int64(c), 10)
		b = append(b, ',')
	}
	return string(b)
}
