package server

import (
	"strconv"

	"github.com/luketucich/cogfab/internal/engine"
)

// The material the client draws and the total the server keeps come from the
// same idea, run on each side: chunks ride the belts at a shared speed, spaced
// a shared gap apart, and are tallied when they reach a seller. The constants
// are mirrored in web/src/world/economy.ts and the emission logic in
// web/src/world/FlowItems.tsx; keep them in step.
const (
	materialSpeed = 2.5 // belts per second a chunk travels, before Belt Speed levels
	materialGap   = 0.5 // belts between chunks; speed/gap = 5 chunks per second

	// subSteps is the sim steps per one-second tick: enough that a chunk never
	// skips a belt, with room to emit one chunk per step at the sim cap (~39/sec).
	subSteps = 40
)

// extractorMult and beltMult are the level multipliers the two rate upgrades
// apply: each Extractor Rate level adds half the base emission rate, each Belt
// Speed level a quarter of the base speed. Everything that moves or prices
// material derives from these two. Keep in step with economy.ts.
func extractorMult(level int) float64 { return 1 + 0.5*float64(level) }
func beltMult(level int) float64      { return 1 + 0.25*float64(level) }

// maxSimLevel is where the simulation stops drawing more chunks. Past this,
// one visible chunk carries a batch of raw units so throughput stays accurate
// without making the browser animate an unbounded number of items.
const maxSimLevel = 5

// emitGap is how close together chunks leave the extractors, capped at the sim
// cap. Keep in step with FlowItems.tsx.
func (h *Hub) emitGap() float64 {
	return materialGap / extractorMult(min(h.extractorLevel, maxSimLevel))
}

// beltSpeed is how fast chunks travel, capped at the sim cap. Faster belts
// also deliver more often at the same spacing.
func (h *Hub) beltSpeed() float64 {
	return materialSpeed * beltMult(min(h.beltLevel, maxSimLevel))
}

// saleValueMultiplier is the global multiplier from the Sale Value upgrade.
func (h *Hub) saleValueMultiplier() int {
	return 1 + h.valueLevel
}

func rawValue(kind engine.ResourceKind) int {
	switch kind {
	case engine.Copper:
		return 3
	case engine.Quartz:
		return 8
	case engine.Gold:
		return 20
	default:
		return 1
	}
}

func (h *Hub) chunkValue(kind engine.ResourceKind, units int) int {
	return rawValue(kind) * units * h.saleValueMultiplier()
}

// unitsPerChunk converts throughput above the visual cap into units carried by
// each visible chunk. The route keeps the fractional remainder between emits.
func (h *Hub) unitsPerChunk() float64 {
	units := 1.0
	if h.extractorLevel > maxSimLevel {
		units *= extractorMult(h.extractorLevel) / extractorMult(maxSimLevel)
	}
	if h.beltLevel > maxSimLevel {
		units *= beltMult(h.beltLevel) / beltMult(maxSimLevel)
	}
	return units
}

// currentRate is the factory's credits per second: actual item throughput times
// each route's raw-material value and the global sale multiplier.
// Derived from the routes instead of measured, so the HUD reads steady instead
// of flickering with the sub-second timing of individual deliveries.
func (h *Hub) currentRate() float64 {
	chunksPerSec := materialSpeed * beltMult(h.beltLevel) / (materialGap / extractorMult(h.extractorLevel))
	value := 0
	for _, rt := range h.routes {
		value += rawValue(rt.resource)
	}
	return float64(value*h.saleValueMultiplier()) * chunksPerSec
}

// route is one extractor-to-seller path the material rides: the belts it crosses
// (extractor mouth first, seller mouth last) and the seller cell at the end. Chunks
// point at it, so a path rebuilt unchanged keeps the same route and its chunks keep
// flowing.
type route struct {
	cells     []int
	extractor int
	seller    int
	resource  engine.ResourceKind
	unitPart  float64
	nearest   float64 // scratch: the closest chunk to the extractor this sub-step, for emit
}

// chunk is one visible item in flight. Units may be greater than one when
// upgrades push physical throughput beyond the visual simulation cap.
type chunk struct {
	route *route
	dist  float64
	units int
}

// recompute rebuilds the live routes after a world change, reusing one whose path
// is unchanged so the chunks on it keep flowing. Chunks on a route that is gone
// keep their pointer and drain off on their own.
func (h *Hub) recompute() {
	next := make(map[string]*route)
	for _, p := range h.world.Producers() {
		x, y := p.Cell%h.world.Width(), p.Cell/h.world.Width()
		deposit := h.world.DepositAt(x, y)
		if deposit.Kind == engine.NoResource || deposit.Remaining == 0 {
			continue
		}
		key := routeKey(p.Cell, p.Path)
		if was, ok := h.routes[key]; ok {
			was.seller = p.Seller
			was.resource = deposit.Kind
			next[key] = was
		} else {
			next[key] = &route{
				cells: p.Path, extractor: p.Cell, seller: p.Seller, resource: deposit.Kind,
			}
		}
	}
	h.routes = next
}

// tick advances material one second in small steps, tallying every chunk that lands
// in its seller and dropping every chunk whose belt is gone, then tops up each
// route with fresh chunks from its extractor. Every stream that reaches a seller
// pays, so each extractor you connect adds a full line of income.
func (h *Hub) tick() bool {
	earned := 0
	speed := h.beltSpeed()
	resourcesChanged := false
	depositDepleted := false
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
					earned += h.chunkValue(c.route.resource, c.units)
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
		changed, depleted := h.emit()
		resourcesChanged = changed || resourcesChanged
		depositDepleted = depleted || depositDepleted
	}
	h.credits += earned
	if depositDepleted {
		h.recompute()
	}
	return resourcesChanged
}

// emit adds a chunk at the head of each route once the nearest one has moved a
// gap ahead, reading the nearest the advance pass already noted (a rescan here
// went quadratic on big boards). The new chunk starts at the overshoot past the
// gap, not at zero, so no spacing is lost between steps and the long-run rate
// is exactly beltSpeed/emitGap through the visual range. Batched units carry
// the remaining physical throughput at deeper upgrade levels. The two results
// distinguish a routine stock update from a deposit that invalidated its route.
func (h *Hub) emit() (changed, depleted bool) {
	gap := h.emitGap()
	for _, rt := range h.routes {
		dist := 0.0
		if rt.nearest < 0 {
			dist = 0
		} else if rt.nearest >= gap {
			dist = rt.nearest - gap
		} else {
			continue
		}
		rt.unitPart += h.unitsPerChunk()
		requested := int(rt.unitPart)
		rt.unitPart -= float64(requested)
		x, y := rt.extractor%h.world.Width(), rt.extractor/h.world.Width()
		if units := h.world.Consume(x, y, requested); units > 0 {
			h.chunks = append(h.chunks, &chunk{route: rt, dist: dist, units: units})
			changed = true
			depleted = h.world.DepositAt(x, y).Remaining == 0 || depleted
		}
	}
	return changed, depleted
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
