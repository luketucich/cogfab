package engine

// steps is the grid step for each Direction (North, East, South, West): x runs
// east, y runs south. It doubles as the list of orthogonal neighbours.
var steps = [4][2]int{{0, -1}, {1, 0}, {0, 1}, {-1, 0}}

// opposite is the Direction facing the other way.
func opposite(d Direction) Direction { return (d + 2) % 4 }

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

// Producer is one productive extractor: the belts its material crosses
// (extractor mouth first, seller mouth last) and the seller cell it lands in.
type Producer struct {
	Cell   int
	Path   []int
	Seller int
}

// Producers lists every extractor whose material reaches a seller. Material
// leaves an extractor only from the side it faces and enters a seller only on
// the side it faces, so the run starts at the belt at the extractor's mouth and
// ends at the belt at a seller's mouth. Mirrors the client's flowPaths; keep
// the two in step.
func (w *World) Producers() []Producer {
	var out []Producer
	for i := range w.tiles {
		if w.tiles[i].Kind != Extractor {
			continue
		}
		mouth := w.faceCell(i, w.tiles[i].Dir)
		if mouth < 0 || w.tiles[mouth].Kind != Belt {
			continue // the extractor is not facing a belt
		}
		if path, seller, reached := w.pathToSeller(mouth); reached {
			out = append(out, Producer{Cell: i, Path: path, Seller: seller})
		}
	}
	return out
}

// pathToSeller walks belts out from start (an extractor's mouth belt) to the
// nearest seller mouth, returning the ordered belts on that path, the seller cell,
// and whether a seller was reached. A seller counts only when it faces the belt
// feeding it.
func (w *World) pathToSeller(start int) (path []int, seller int, reached bool) {
	prev := map[int]int{}
	seen := map[int]bool{start: true}
	queue := []int{start}
	end := -1
	for len(queue) > 0 && end < 0 {
		cur := queue[0]
		queue = queue[1:]
		for d := Direction(0); d < 4; d++ {
			n := w.faceCell(cur, d)
			if n < 0 {
				continue
			}
			kind := w.tiles[n].Kind
			if kind == Seller && w.tiles[n].Dir == opposite(d) {
				end, seller = cur, n // cur sits at the seller's mouth
				break
			}
			if kind == Belt && !seen[n] {
				seen[n] = true
				prev[n] = cur
				queue = append(queue, n)
			}
		}
	}
	if end < 0 {
		return nil, -1, false
	}
	// rebuild the path from the start belt to the seller mouth
	order := []int{end}
	for c := end; c != start; {
		c = prev[c]
		order = append(order, c)
	}
	for i, j := 0, len(order)-1; i < j; i, j = i+1, j-1 {
		order[i], order[j] = order[j], order[i]
	}
	return order, seller, true
}
