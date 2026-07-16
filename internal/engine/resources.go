package engine

// ResourceKind identifies the raw material held by a deposit.
type ResourceKind uint8

const (
	NoResource ResourceKind = iota
	Iron
	Copper
	Quartz
	Gold
)

// Deposit is a finite raw-material source beneath a factory tile.
type Deposit struct {
	Kind      ResourceKind
	Remaining int
	Capacity  int
}

// DepositAt returns the resource deposit at a cell, if any.
func (w *World) DepositAt(x, y int) Deposit {
	if !w.inBounds(x, y) {
		return Deposit{}
	}
	return w.deposits[w.index(x, y)]
}

// SetDeposit places a finite deposit at a cell. Invalid deposits clear it.
func (w *World) SetDeposit(x, y int, kind ResourceKind, amount int) {
	if !w.inBounds(x, y) {
		return
	}
	if kind <= NoResource || kind > Gold || amount <= 0 {
		w.deposits[w.index(x, y)] = Deposit{}
		return
	}
	w.deposits[w.index(x, y)] = Deposit{Kind: kind, Remaining: amount, Capacity: amount}
}

// RestoreDeposit sets both the original capacity and current stock when a
// saved room is loaded.
func (w *World) RestoreDeposit(x, y int, kind ResourceKind, remaining, capacity int) {
	if !w.inBounds(x, y) {
		return
	}
	if kind <= NoResource || kind > Gold || remaining < 0 || capacity <= 0 || remaining > capacity {
		w.deposits[w.index(x, y)] = Deposit{}
		return
	}
	w.deposits[w.index(x, y)] = Deposit{Kind: kind, Remaining: remaining, Capacity: capacity}
}

// Consume removes up to amount units from a deposit and returns how many were
// available. It never lets the stock become negative.
func (w *World) Consume(x, y, amount int) int {
	if !w.inBounds(x, y) || amount <= 0 {
		return 0
	}
	i := w.index(x, y)
	if w.deposits[i].Remaining < amount {
		amount = w.deposits[i].Remaining
	}
	w.deposits[i].Remaining -= amount
	return amount
}

// SetPort marks whether a cell is a shipping port.
func (w *World) SetPort(x, y int, port bool) {
	if w.inBounds(x, y) {
		w.ports[w.index(x, y)] = port
	}
}

// HasPort reports whether a seller may be placed at a cell.
func (w *World) HasPort(x, y int) bool {
	return w.inBounds(x, y) && w.ports[w.index(x, y)]
}
