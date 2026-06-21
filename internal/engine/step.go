package engine

// Step moves the simulation forward one tick: belts move their items, then
// extractors drop new ore. Belts go first so a spot that just freed up can be
// filled the same tick.
func (w *World) Step() {
	w.stepBelts()
	w.stepExtractors()
}

// stepBelts moves each item forward one tile. It works out the next layout from
// the current one, so every item moves exactly one tile and items never jump
// over, merge into, or copy each other.
func (w *World) stepBelts() {
	next := make([]ItemKind, len(w.tiles))

	for i := range w.tiles {
		item := w.tiles[i].Item
		if item == ItemNone {
			continue
		}
		if w.tiles[i].Kind != Belt { // only belts move items along
			next[i] = item
			continue
		}
		if dst, ok := w.downstream(i); ok &&
			w.tiles[dst].Kind == Belt &&
			w.tiles[dst].Item == ItemNone &&
			next[dst] == ItemNone {
			next[dst] = item // move it forward
		} else {
			next[i] = item // stuck; stays put
		}
	}

	for i := range w.tiles {
		w.tiles[i].Item = next[i]
	}
}

// stepExtractors has each extractor drop one ore onto the belt in front of it,
// once every period ticks, when there's room. If the belt is full it waits and
// retries next tick, so no ore is created or lost.
func (w *World) stepExtractors() {
	for i := range w.tiles {
		if w.tiles[i].Kind != Extractor {
			continue
		}
		if w.tiles[i].cooldown > 0 {
			w.tiles[i].cooldown--
			continue
		}
		dst, ok := w.downstream(i)
		if ok && w.tiles[dst].Kind == Belt && w.tiles[dst].Item == ItemNone {
			w.tiles[dst].Item = ItemOre
			w.tiles[i].cooldown = w.tiles[i].period - 1 // this drop counts as tick 1 of the wait
		}
	}
}

// downstream is the tile one step ahead in tile i's direction, and whether that
// tile is still on the grid.
func (w *World) downstream(i int) (int, bool) {
	x, y := i%w.width, i/w.width
	dx, dy := w.tiles[i].Dir.delta()
	nx, ny := x+dx, y+dy
	if !w.inBounds(nx, ny) {
		return 0, false
	}
	return w.index(nx, ny), true
}
