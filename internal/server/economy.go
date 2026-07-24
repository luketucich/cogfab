package server

import (
	"strconv"

	"github.com/luketucich/cogfab/internal/engine"
	"github.com/luketucich/cogfab/internal/wire"
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

	// baseRefineTime is how long a level-0 refiner holds one job, in seconds.
	// At the untouched 5 ore/s line rate, 0.4s processes half the incoming ore:
	// the 3x sale price makes that line earn 1.5x as fast while its deposit lasts
	// twice as long. Mirror of BASE_REFINE_TIME in economy.ts.
	baseRefineTime = 0.4
)

// extractorMult and beltMult are the level multipliers the two rate upgrades
// apply: each Extractor Rate level adds half the base emission rate, each Belt
// Speed level a quarter of the base speed. Everything that moves or prices
// material derives from these two. Keep in step with economy.ts.
func extractorMult(level int) float64 { return 1 + 0.5*float64(level) }
func beltMult(level int) float64      { return 1 + 0.25*float64(level) }

// refineMult is the Refiner Speed scale: each level cuts process time the same
// way Extractor Rate raises emission. Keep in step with economy.ts.
func refineMult(level int) float64 { return 1 + 0.5*float64(level) }

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

// refineTime is how long one refiner job takes at the current upgrade level.
func (h *Hub) refineTime() float64 {
	return baseRefineTime / refineMult(h.refinerLevel)
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
	case engine.IronBar:
		return 3
	case engine.CopperSheet:
		return 9
	case engine.QuartzCrystal:
		return 24
	case engine.GoldIngot:
		return 60
	default:
		return 1
	}
}

// JavaScript receives credits as JSON numbers, so the server saturates at the
// largest integer the browser can represent exactly instead of Go's wider
// platform-dependent int limit.
const maxCredits = 1<<53 - 1

func addCredits(balance, amount int) int {
	if amount > maxCredits-balance {
		return maxCredits
	}
	return balance + amount
}

func multiplyCredits(a, b int) int {
	if a != 0 && b > maxCredits/a {
		return maxCredits
	}
	return a * b
}

func (h *Hub) chunkValue(kind engine.ResourceKind, units int) int {
	return multiplyCredits(multiplyCredits(rawValue(kind), units), h.saleValueMultiplier())
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
// each route's material value and the global sale multiplier. Routes that pass
// through the same refiner share that machine's processing capacity.
func (h *Hub) currentRate() float64 {
	visibleChunksPerSec := h.beltSpeed() / h.emitGap()
	unitsPerChunk := h.unitsPerChunk()
	unitsPerSec := visibleChunksPerSec * unitsPerChunk
	type refinerRate struct {
		routes int
		value  int
	}
	var refinerRates map[int]refinerRate
	total := 0.0
	for _, rt := range h.routes {
		if rt.refines {
			if refinerRates == nil {
				refinerRates = make(map[int]refinerRate)
			}
			rate := refinerRates[rt.refiner]
			rate.routes++
			rate.value += rawValue(engine.Refine(rt.resource))
			refinerRates[rt.refiner] = rate
			continue
		}
		total += float64(rawValue(rt.resource)) * unitsPerSec
	}

	refinePerSec := 1.0 / h.refineTime()
	for _, rate := range refinerRates {
		refinedUnitsPerSec := min(float64(rate.routes)*unitsPerSec, refinePerSec)
		averageValue := float64(rate.value) / float64(rate.routes)
		total += refinedUnitsPerSec * averageValue
	}
	return total * float64(h.saleValueMultiplier())
}

// route is one extractor-to-seller path the material rides: the belts and
// refiners it crosses (extractor mouth first, seller mouth last) and the seller
// cell at the end. Chunks point at it, so a path rebuilt unchanged keeps the
// same route and its chunks keep flowing.
type route struct {
	cells     []int
	extractor int
	seller    int
	resource  engine.ResourceKind
	unitPart  float64
	nearest   float64 // scratch: the closest chunk to the extractor this sub-step, for emit
	refiner   int     // first refiner cell on the route
	refinerAt int     // index of that cell in cells
	refines   bool
	rawFront  float64 // scratch: closest queued raw chunk to the refiner this sub-step
}

// chunk is one visible item in flight. Units may be greater than one when
// upgrades push physical throughput beyond the visual simulation cap. Resource
// starts as the deposit ore and upgrades when a refiner finishes a job.
type chunk struct {
	route       *route
	dist        float64
	units       int
	resource    engine.ResourceKind
	processLeft float64
	waiting     bool // scratch: this raw chunk was stopped by a refiner queue
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
			setRouteRefiner(h.world, was)
			next[key] = was
		} else {
			rt := &route{
				cells: p.Path, extractor: p.Cell, seller: p.Seller, resource: deposit.Kind,
			}
			setRouteRefiner(h.world, rt)
			next[key] = rt
		}
	}
	h.routes = next
	// Chunks from a depleted or broken source keep draining on an inactive
	// route object. Refresh those routes too so a refiner added or removed
	// while they are in flight is reflected by processing, backpressure, and
	// the status UI.
	refreshed := make(map[*route]bool, len(h.routes))
	for _, rt := range h.routes {
		refreshed[rt] = true
	}
	for _, c := range h.chunks {
		if !refreshed[c.route] {
			setRouteRefiner(h.world, c.route)
			refreshed[c.route] = true
		}
	}
	// Drop busy marks for refiners that no longer exist on any live route.
	for cell, owner := range h.refinerBusy {
		if !h.world.IsRefiner(cell) {
			if owner != nil {
				owner.processLeft = 0
			}
			delete(h.refinerBusy, cell)
		}
	}
}

func setRouteRefiner(world *engine.World, rt *route) {
	rt.refines = false
	for step, cell := range rt.cells {
		if world.IsRefiner(cell) {
			rt.refiner = cell
			rt.refinerAt = step
			rt.refines = true
			return
		}
	}
}

// tick advances material one second in small steps, tallying every chunk that lands
// in its seller and dropping every chunk whose belt is gone, then tops up each
// route with fresh chunks from its extractor. Every stream that reaches a seller
// pays, so each extractor you connect adds a full line of income.
func (h *Hub) tick() bool {
	earned := 0
	speed := h.beltSpeed()
	dt := 1.0 / subSteps
	resourcesChanged := false
	depositDepleted := false
	refinerBudget := make(map[int]float64)
	for s := 0; s < subSteps; s++ {
		clear(refinerBudget)
		for _, rt := range h.routes {
			rt.nearest = -1
			rt.rawFront = -1
		}
		for _, c := range h.chunks {
			// A depleted extractor removes its route from h.routes while the
			// already-consumed chunks keep their route pointer and drain. Reset
			// that route's queue scratch too, so its first raw chunk is not
			// packed behind stale state from the previous sub-step.
			c.route.rawFront = -1
			c.waiting = false
		}
		alive := h.chunks[:0]
		for _, c := range h.chunks {
			if h.advanceChunk(c, speed, dt, refinerBudget) {
				if h.world.IsSeller(c.route.seller) {
					earned = addCredits(earned, h.chunkValue(c.resource, c.units))
				}
				continue
			}
			cell := int(c.dist)
			if cell >= len(c.route.cells) || !h.world.IsConveying(c.route.cells[cell]) {
				h.clearRefinerJob(c)
				continue // its path cell is gone: fell off
			}
			if c.route.refines && engine.IsRaw(c.resource) {
				// Chunks are append-only and visited oldest-first. Pack each
				// waiting ore one visible gap behind the ore ahead; once the
				// queue reaches the extractor at distance zero, nearest stops
				// emission naturally. Persisted oversized queues overlap at
				// zero until they drain rather than losing consumed ore.
				if c.route.rawFront >= 0 {
					maxDistance := max(c.route.rawFront-h.emitGap(), 0)
					if c.dist > maxDistance {
						if c.dist-maxDistance > 1e-9 {
							c.waiting = true
						}
						c.dist = maxDistance
					}
				}
				c.route.rawFront = c.dist
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
	h.credits = addCredits(h.credits, earned)
	if depositDepleted {
		h.recompute()
	}
	return resourcesChanged
}

// advanceChunk moves one chunk forward, pausing on refiners while they work.
// refinerBudget gives every machine exactly dt of processing per sub-step. If
// one job finishes early, only its unused fraction is available to the next
// queued job. It returns true when the chunk has been delivered to its seller.
func (h *Hub) advanceChunk(c *chunk, speed, dt float64, refinerBudget map[int]float64) (delivered bool) {
	cell := int(c.dist)
	if cell < len(c.route.cells) && h.world.IsRefiner(c.route.cells[cell]) && engine.IsRaw(c.resource) {
		refiner := c.route.cells[cell]
		if owner, busy := h.refinerBusy[refiner]; busy && owner != c {
			c.dist = float64(cell)
			c.waiting = true
			return false
		}
		if c.processLeft <= 0 {
			h.refinerBusy[refiner] = c
			// Past the visual simulation cap one chunk represents several ore.
			// Processing time scales with that batch so the rendering cap never
			// grants free refiner capacity.
			c.processLeft = h.refineTime() * float64(c.units)
		}
		budget, exists := refinerBudget[refiner]
		if !exists {
			budget = dt
		}
		used := min(c.processLeft, budget)
		c.processLeft -= used
		refinerBudget[refiner] = budget - used
		if c.processLeft > 1e-12 {
			// Hold the active job inside the machine, one emission gap past
			// its entrance. The next queued ore can wait exactly at the
			// entrance and begin immediately when this job finishes.
			c.dist = float64(cell) + h.emitGap()
			return false
		}
		c.processLeft = 0
		c.resource = engine.Refine(c.resource)
		delete(h.refinerBusy, refiner)
	}

	c.dist += speed * dt
	if int(c.dist) >= len(c.route.cells) {
		h.clearRefinerJob(c)
		return true
	}
	return false
}

func (h *Hub) clearRefinerJob(c *chunk) {
	for cell, owner := range h.refinerBusy {
		if owner == c {
			delete(h.refinerBusy, cell)
		}
	}
}

// refinerViews reports every placed refiner, including idle ones, so clients
// can show a truthful hover state without reconstructing queue ownership from
// cosmetic item motion.
func (h *Hub) refinerViews() []wire.RefinerView {
	processDuration := h.refineTime() * h.unitsPerChunk()
	views := make([]wire.RefinerView, 0)
	byCell := make(map[int]int)
	for y := 0; y < h.world.Height(); y++ {
		for x := 0; x < h.world.Width(); x++ {
			if h.world.At(x, y).Kind != engine.Refiner {
				continue
			}
			cell := y*h.world.Width() + x
			byCell[cell] = len(views)
			views = append(views, wire.RefinerView{X: x, Y: y, Duration: processDuration})
		}
	}

	arrivalCadence := make(map[int]float64)
	routeCounts := make(map[int]int)
	for _, rt := range h.routes {
		if rt.refines {
			routeCounts[rt.refiner]++
		}
	}
	for cell, routes := range routeCounts {
		// Shared input routes shorten the average arrival interval before
		// processing capacity becomes the bottleneck again.
		arrivalInterval := h.emitGap() / (h.beltSpeed() * float64(routes))
		arrivalCadence[cell] = max(processDuration, arrivalInterval)
	}

	for cell, owner := range h.refinerBusy {
		if index, ok := byCell[cell]; ok && owner != nil {
			views[index].Resource = owner.resource.String()
			views[index].Remaining = max(owner.processLeft, 0)
			views[index].Duration = h.refineTime() * float64(owner.units)
		}
	}
	for _, c := range h.chunks {
		if !c.route.refines || !engine.IsRaw(c.resource) {
			continue
		}
		if int(c.dist) > c.route.refinerAt {
			continue // this raw chunk was already downstream when the refiner was placed
		}
		index, ok := byCell[c.route.refiner]
		if !ok || h.refinerBusy[c.route.refiner] == c {
			continue
		}
		if c.waiting {
			views[index].Queued++
		} else {
			views[index].Incoming++
		}
		if views[index].Resource == "" {
			travel := max(float64(c.route.refinerAt)-c.dist, 0) / h.beltSpeed()
			nextOutput := travel + h.refineTime()*float64(c.units)
			if views[index].NextOutput == 0 || nextOutput < views[index].NextOutput {
				views[index].NextOutput = nextOutput
			}
		}
	}
	for cell, index := range byCell {
		if views[index].Resource == "" && views[index].Queued == 0 && views[index].Incoming > 0 {
			if cadence := arrivalCadence[cell]; cadence > 0 {
				views[index].Duration = cadence
			}
		}
	}
	return views
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
			h.chunks = append(h.chunks, &chunk{
				route: rt, dist: dist, units: units, resource: rt.resource,
			})
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
