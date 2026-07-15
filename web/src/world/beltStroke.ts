import type { BeltPlacement, Dir } from "../net/types";
import { cellsBetween, dirBetween, type Cell } from "./grid";

const sameCell = (a: Cell, b: Cell): boolean => a.x === b.x && a.y === b.y;

// extendBeltStroke fills fast pointer jumps and lets dragging backward shorten
// the preview before anything is sent to the server.
export function extendBeltStroke(cells: Cell[], to: Cell): Cell[] {
  let next = [...cells];
  for (const step of cellsBetween(next[next.length - 1], to)) {
    const existing = next.findIndex((cell) => sameCell(cell, step));
    next = existing >= 0 ? next.slice(0, existing + 1) : [...next, step];
  }
  return next;
}

// beltPlacements gives every preview cell its final facing. The last belt
// follows the drag into it; a single click uses the player's current aim.
export function beltPlacements(cells: Cell[], facing: Dir, locked: boolean): BeltPlacement[] {
  return cells.map((cell, index) => {
    let dir = facing;
    if (!locked && cells.length > 1) {
      dir = index < cells.length - 1 ? dirBetween(cell, cells[index + 1]) : dirBetween(cells[index - 1], cell);
    }
    return { ...cell, dir };
  });
}
