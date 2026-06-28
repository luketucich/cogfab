import { describe, it, expect } from "vitest";
import { flow } from "./flow";
import type { Dir, StateMessage, TileView } from "../net/types";

// grid builds a snapshot from a map of "x,y" -> tile; missing cells are empty.
function grid(width: number, height: number, cells: Record<string, TileView>): StateMessage {
  const tiles: TileView[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      tiles.push(cells[`${x},${y}`] ?? { kind: "empty", dir: "north" });
    }
  }
  return { type: "state", width, height, tiles };
}

const E = (dir: Dir): TileView => ({ kind: "extractor", dir });
const B = (dir: Dir): TileView => ({ kind: "belt", dir });
const S = (): TileView => ({ kind: "seller", dir: "north" });
const idx = (x: number, y: number, w: number) => y * w + x;

describe("flow", () => {
  it("runs straight from extractor to seller and marks it complete", () => {
    const snap = grid(4, 1, { "0,0": E("east"), "1,0": B("east"), "2,0": B("east"), "3,0": S() });
    const f = flow(snap);
    expect(f.get(idx(1, 0, 4))).toEqual({ entry: "west", exit: "east", complete: true });
    expect(f.get(idx(2, 0, 4))).toEqual({ entry: "west", exit: "east", complete: true });
    expect(f.size).toBe(2); // only the belts are live, not the extractor or seller
  });

  it("marks a run that never reaches a seller broken", () => {
    const snap = grid(4, 1, { "0,0": E("east"), "1,0": B("east"), "2,0": B("east") });
    const f = flow(snap);
    expect(f.get(idx(1, 0, 4))?.complete).toBe(false);
    expect(f.get(idx(2, 0, 4))?.complete).toBe(false);
  });

  it("turns the dot through a corner (entry and exit are perpendicular)", () => {
    const snap = grid(3, 3, { "0,0": E("east"), "1,0": B("east"), "2,0": B("east"), "2,1": B("south"), "2,2": S() });
    const f = flow(snap);
    expect(f.get(idx(2, 0, 3))).toEqual({ entry: "west", exit: "south", complete: true });
    expect(f.get(idx(2, 1, 3))?.complete).toBe(true);
  });

  it("flows along the connected path even when a belt faces the wrong way", () => {
    // the middle belt faces back west, but it is still connected, so flow runs
    const snap = grid(4, 1, { "0,0": E("east"), "1,0": B("west"), "2,0": B("east"), "3,0": S() });
    const f = flow(snap);
    expect(f.get(idx(1, 0, 4))?.complete).toBe(true);
    expect(f.get(idx(2, 0, 4))?.complete).toBe(true);
  });
});
