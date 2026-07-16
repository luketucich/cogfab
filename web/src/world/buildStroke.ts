import type { Dir, Placement } from "../net/types";
import { cellsBetween, dirBetween, type Cell } from "./grid";

const sameCell = (a: Cell, b: Cell): boolean => a.x === b.x && a.y === b.y;

// extendBuildStroke fills fast pointer jumps and lets dragging backward shorten
// the preview before anything is sent to the server.
export function extendBuildStroke(cells: Cell[], to: Cell): Cell[] {
  let next = [...cells];
  for (const step of cellsBetween(next[next.length - 1], to)) {
    const existing = next.findIndex((cell) => sameCell(cell, step));
    next = existing >= 0 ? next.slice(0, existing + 1) : [...next, step];
  }
  return next;
}

// strokePlacements gives every preview cell its final facing. The last building
// follows the drag into it; a click uses the player's current aim.
export function strokePlacements(cells: Cell[], facing: Dir, locked: boolean): Placement[] {
  return cells.map((cell, index) => {
    let dir = facing;
    if (!locked && cells.length > 1) {
      dir = index < cells.length - 1 ? dirBetween(cell, cells[index + 1]) : dirBetween(cells[index - 1], cell);
    }
    return { ...cell, dir };
  });
}
