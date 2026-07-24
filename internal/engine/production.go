package engine

// steps is the grid step for each Direction (North, East, South, West): x runs
// east, y runs south. It doubles as the list of orthogonal neighbours.
var steps = [4][2]int{{0, -1}, {1, 0}, {0, 1}, {-1, 0}}

// opposite is the Direction facing the other way.
func opposite(d Direction) Direction { return (d + 2) % 4 }

// sameAxis reports whether two directions lie on the same straight line. A
// refiner has an axis, not an input end: north/south and east/west are each
// equivalent pairs.
func sameAxis(a, b Direction) bool { return a%2 == b%2 }

// faceCell is the cell one step from i in direction d, or -1 off the grid.
func (w *World) faceCell(i int, d Direction) int {
	x, y := i%w.width, i/w.width
	nx, ny := x+steps[d][0], y+steps[d][1]
	if !w.inBounds(nx, ny) {
		return -1
	}
	return w.index(nx, ny)
}

// IsBelt reports whether cell i holds a belt.
func (w *World) IsBelt(i int) bool { return i >= 0 && i < len(w.tiles) && w.tiles[i].Kind == Belt }

// IsSeller reports whether cell i holds a seller.
func (w *World) IsSeller(i int) bool { return i >= 0 && i < len(w.tiles) && w.tiles[i].Kind == Seller }

// IsRefiner reports whether cell i holds a refiner.
func (w *World) IsRefiner(i int) bool {
	return i >= 0 && i < len(w.tiles) && w.tiles[i].Kind == Refiner
}

// IsConveying reports whether cell i is a belt or refiner that material rides.
func (w *World) IsConveying(i int) bool {
	if i < 0 || i >= len(w.tiles) {
		return false
	}
	kind := w.tiles[i].Kind
	return kind == Belt || kind == Refiner
}

// connectsOn reports whether material can leave conveying cell i on side d.
// Belts connect on every side; a refiner connects on the two sides of its axis.
func (w *World) connectsOn(i int, d Direction) bool {
	if !w.IsConveying(i) {
		return false
	}
	tile := w.tiles[i]
	return tile.Kind == Belt || sameAxis(tile.Dir, d)
}

// StraightBeltDirection returns the axis a refiner should use when replacing
// the belt at (x, y). Complete producer routes are authoritative because they
// include extractor and seller mouths; belts outside a route fall back to
// their neighbouring belts, matching the client's belt-shape preview.
//
// An isolated belt or one with a single connection keeps its stored direction.
// Two opposite connections form a straight axis. Corners and junctions cannot
// be replaced by a straight refiner.
func (w *World) StraightBeltDirection(x, y int) (Direction, bool) {
	if !w.inBounds(x, y) {
		return North, false
	}
	cell := w.index(x, y)
	tile := w.tiles[cell]
	if tile.Kind != Belt {
		return North, false
	}

	var sides [4]bool
	for _, producer := range w.Producers() {
		for pathIndex, pathCell := range producer.Path {
			if pathCell != cell {
				continue
			}
			previous := producer.Cell
			if pathIndex > 0 {
				previous = producer.Path[pathIndex-1]
			}
			next := producer.Seller
			if pathIndex < len(producer.Path)-1 {
				next = producer.Path[pathIndex+1]
			}
			w.addSideToward(cell, previous, &sides)
			w.addSideToward(cell, next, &sides)
		}
	}

	if countSides(sides) == 0 {
		for direction := Direction(0); direction < 4; direction++ {
			sides[direction] = w.IsBelt(w.faceCell(cell, direction))
		}
	}

	count := countSides(sides)
	if count < 2 {
		return tile.Dir, true
	}
	for direction := Direction(0); direction < 4; direction++ {
		if sides[direction] {
			if count == 2 && sides[opposite(direction)] {
				return direction, true
			}
			break
		}
	}
	return North, false
}

func (w *World) addSideToward(cell, neighbour int, sides *[4]bool) {
	for direction := Direction(0); direction < 4; direction++ {
		if w.faceCell(cell, direction) == neighbour {
			sides[direction] = true
			return
		}
	}
}

func countSides(sides [4]bool) int {
	count := 0
	for _, connected := range sides {
		if connected {
			count++
		}
	}
	return count
}

// Producer is one productive extractor: the cells its material crosses
// (extractor mouth first, seller mouth last; refiners sit in the path) and the
// seller cell it lands in.
type Producer struct {
	Cell   int
	Path   []int
	Seller int
}

// pathSearch holds the reusable work buffers for one Producers pass. Before a
// new extractor search it clears only the cells the previous search touched.
type pathSearch struct {
	previous []int
	queue    []int
	visited  int
}

func newPathSearch(cells int) *pathSearch {
	search := &pathSearch{
		previous: make([]int, cells),
		queue:    make([]int, cells),
	}
	for i := range search.previous {
		search.previous[i] = -1
	}
	return search
}

// Producers lists every extractor whose material reaches a seller. Material
// leaves an extractor only from the side it faces and enters a seller only on
// the side it faces. A refiner is a straight, bidirectional processor: either
// end of its axis can be the input. Mirrors the client's flowPaths; keep the two
// in step.
func (w *World) Producers() []Producer {
	var out []Producer
	var search *pathSearch
	for i := range w.tiles {
		if w.tiles[i].Kind != Extractor {
			continue
		}
		mouth := w.faceCell(i, w.tiles[i].Dir)
		if mouth < 0 || !w.connectsOn(mouth, opposite(w.tiles[i].Dir)) {
			continue // the extractor is not facing a connected belt or refiner
		}
		if search == nil {
			search = newPathSearch(len(w.tiles))
		}
		if path, seller, reached := w.pathToSeller(mouth, search); reached {
			out = append(out, Producer{Cell: i, Path: path, Seller: seller})
		}
	}
	return out
}

// pathToSeller walks belts and refiners out from start (an extractor's mouth
// conveyor) to the nearest seller mouth, returning the ordered cells on that path,
// the seller cell, and whether a seller was reached. Sellers still have one
// input mouth; refiners accept material from either end of their straight axis.
func (w *World) pathToSeller(start int, search *pathSearch) (path []int, seller int, reached bool) {
	for i := 0; i < search.visited; i++ {
		search.previous[search.queue[i]] = -1
	}
	search.previous[start] = start
	search.queue[0] = start
	head, tail := 0, 1
	end := -1
	for head < tail && end < 0 {
		current := search.queue[head]
		head++
		for d := Direction(0); d < 4; d++ {
			if !w.connectsOn(current, d) {
				continue
			}
			next := w.faceCell(current, d)
			if next < 0 {
				continue
			}
			kind := w.tiles[next].Kind
			if kind == Seller && w.tiles[next].Dir == opposite(d) {
				end, seller = current, next // current sits at the seller's mouth
				break
			}
			if (kind == Belt || kind == Refiner) && w.connectsOn(next, opposite(d)) && search.previous[next] < 0 {
				search.previous[next] = current
				search.queue[tail] = next
				tail++
			}
		}
	}
	search.visited = tail
	if end < 0 {
		return nil, -1, false
	}
	// rebuild the path from the start belt to the seller mouth
	order := []int{end}
	for c := end; c != start; {
		c = search.previous[c]
		order = append(order, c)
	}
	for i, j := 0, len(order)-1; i < j; i, j = i+1, j-1 {
		order[i], order[j] = order[j], order[i]
	}
	return order, seller, true
}
