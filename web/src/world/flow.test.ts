import { describe, it, expect } from "vitest";
import { flowPaths, drainRuns } from "./flow";
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
const S = (dir: Dir): TileView => ({ kind: "seller", dir });

describe("flowPaths", () => {
  it("returns a complete run from the extractor to the seller", () => {
    const snap = grid(4, 1, { "0,0": E("east"), "1,0": B("east"), "2,0": B("east"), "3,0": S("west") });
    const runs = flowPaths(snap);
    expect(runs.length).toBe(1);
    expect(runs[0].complete).toBe(true);
    expect(runs[0].steps.map((s) => [s.x, s.y])).toEqual([
      [1, 0],
      [2, 0],
    ]);
    expect(runs[0].steps[0].entry).toBe("west"); // enters from the extractor
    expect(runs[0].steps[1].exit).toBe("east"); // leaves into the seller
  });

  it("marks a run that reaches no seller broken, tracing to the farthest belt", () => {
    const snap = grid(4, 1, { "0,0": E("east"), "1,0": B("east"), "2,0": B("east") });
    const runs = flowPaths(snap);
    expect(runs.length).toBe(1);
    expect(runs[0].complete).toBe(false);
    expect(runs[0].steps.map((s) => [s.x, s.y])).toEqual([
      [1, 0],
      [2, 0],
    ]);
  });

  it("orders a complete run through a corner into the seller", () => {
    const snap = grid(3, 3, { "0,0": E("east"), "1,0": B("east"), "2,0": B("east"), "2,1": B("south"), "2,2": S("north") });
    const runs = flowPaths(snap);
    expect(runs.length).toBe(1);
    expect(runs[0].steps.map((s) => [s.x, s.y])).toEqual([
      [1, 0],
      [2, 0],
      [2, 1],
    ]);
    expect(runs[0].steps[runs[0].steps.length - 1].exit).toBe("south");
  });

  it("traces a run from each extractor", () => {
    // two extractors feed belts that merge into the seller's mouth
    const snap = grid(3, 3, {
      "0,0": E("east"),
      "0,2": E("east"),
      "1,0": B("east"),
      "1,1": B("south"),
      "1,2": B("east"),
      "2,1": S("west"),
    });
    const runs = flowPaths(snap);
    expect(runs.length).toBe(2);
    expect(runs.every((r) => r.complete)).toBe(true);
  });

  it("routes along connected belts whichever way a belt faces", () => {
    const snap = grid(4, 1, { "0,0": E("east"), "1,0": B("west"), "2,0": B("east"), "3,0": S("west") });
    const runs = flowPaths(snap);
    expect(runs.length).toBe(1);
    expect(runs[0].complete).toBe(true);
  });
});

describe("drainRuns", () => {
  const keys = (runs: { key: string }[]) => runs.map((r) => r.key);

  it("keeps live runs and leaves them alive", () => {
    const next = drainRuns([], [{ key: "a", death: null }], 0, 1);
    expect(next).toEqual([{ key: "a", death: null }]);
  });

  it("stamps a vanished run with the time it was cut", () => {
    const next = drainRuns([{ key: "a", death: null }], [], 5, 1);
    expect(next).toEqual([{ key: "a", death: 5 }]);
  });

  it("keeps a cut run draining until its window passes, then drops it", () => {
    const cut = [{ key: "a", death: 5 }];
    expect(keys(drainRuns(cut, [], 5.5, 1))).toEqual(["a"]); // still within the window
    expect(keys(drainRuns(cut, [], 7, 1))).toEqual([]); // window passed
  });

  it("revives a run that comes back, dropping its draining copy", () => {
    const next = drainRuns([{ key: "a", death: 5 }], [{ key: "a", death: null }], 5.5, 1);
    expect(next).toEqual([{ key: "a", death: null }]);
  });
});
