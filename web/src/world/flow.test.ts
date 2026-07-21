import { describe, it, expect } from "vitest";
import { drainRuns, flowConnections, flowPaths, refinedBeltCells, removeDrainedRuns, runKey } from "./flow";
import type { Dir, StateMessage, TileView } from "../net/types";

// grid builds a snapshot from a map of "x,y" -> tile; missing cells are empty.
function grid(width: number, height: number, cells: Record<string, TileView>): StateMessage {
  const tiles: TileView[] = [];
  const deposits: StateMessage["deposits"] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tile = cells[`${x},${y}`] ?? { kind: "empty", dir: "north" };
      tiles.push(tile);
      if (tile.kind === "extractor") deposits.push({ x, y, kind: "iron", capacity: 100, remaining: 100 });
    }
  }
  return { type: "state", width, height, tiles, deposits, ports: [] };
}

const E = (dir: Dir): TileView => ({ kind: "extractor", dir });
const B = (dir: Dir): TileView => ({ kind: "belt", dir });
const S = (dir: Dir): TileView => ({ kind: "seller", dir });
const R = (dir: Dir): TileView => ({ kind: "refiner", dir });

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

  it("routes through a correctly faced refiner", () => {
    const snap = grid(5, 1, {
      "0,0": E("east"),
      "1,0": B("east"),
      "2,0": R("west"),
      "3,0": B("east"),
      "4,0": S("west"),
    });
    const runs = flowPaths(snap);
    expect(runs.length).toBe(1);
    expect(runs[0].complete).toBe(true);
    expect(runs[0].steps.map((s) => [s.x, s.y])).toEqual([
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
    expect([...refinedBeltCells(snap)]).toEqual([3]);
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
    expect(flowConnections(snap).get(4)).toEqual(["north", "east", "south"]);
  });

  it("routes along connected belts whichever way a belt faces", () => {
    const snap = grid(4, 1, { "0,0": E("east"), "1,0": B("west"), "2,0": B("east"), "3,0": S("west") });
    const runs = flowPaths(snap);
    expect(runs.length).toBe(1);
    expect(runs[0].complete).toBe(true);
  });

  it("keeps the existing north-first route when sellers are equally close", () => {
    const snap = grid(4, 3, {
      "1,0": S("south"),
      "1,1": B("north"),
      "0,2": E("east"),
      "1,2": B("east"),
      "2,2": B("east"),
      "3,2": S("west"),
    });

    expect(flowPaths(snap)[0].steps.map(({ x, y }) => [x, y])).toEqual([
      [1, 2],
      [1, 1],
    ]);
  });

  it("carries its source identity and resource kind", () => {
    const snap = grid(4, 1, { "0,0": E("east"), "1,0": B("east"), "2,0": B("east"), "3,0": S("west") });
    snap.deposits[0] = { ...snap.deposits[0], kind: "copper" };
    const run = flowPaths(snap)[0];
    expect(run.resource).toBe("copper");
    expect(run.source).toBe(0);
    expect(runKey({ ...run, source: 4 })).not.toBe(runKey(run));
  });

  it("reuses topology for resource updates while refreshing active state", () => {
    const snap = grid(4, 1, { "0,0": E("east"), "1,0": B("east"), "2,0": B("east"), "3,0": S("west") });
    const liveRuns = flowPaths(snap);
    const liveConnections = flowConnections(snap);
    const depleted = { ...snap, deposits: [{ ...snap.deposits[0], remaining: 0 }] };
    const depletedRuns = flowPaths(depleted);

    expect(depletedRuns[0].active).toBe(false);
    expect(depletedRuns[0].steps).toBe(liveRuns[0].steps);
    expect(flowConnections(depleted)).toBe(liveConnections);
  });

  it("keeps the run snapshot stable while stock changes above zero", () => {
    const snap = grid(4, 1, { "0,0": E("east"), "1,0": B("east"), "2,0": B("east"), "3,0": S("west") });
    const liveRuns = flowPaths(snap);
    const updated = { ...snap, deposits: [{ ...snap.deposits[0], remaining: 99 }] };

    expect(flowPaths(updated)).toBe(liveRuns);
  });

  it("refreshes the material without rebuilding the route", () => {
    const snap = grid(4, 1, { "0,0": E("east"), "1,0": B("east"), "2,0": B("east"), "3,0": S("west") });
    const ironRun = flowPaths(snap)[0];
    const connections = flowConnections(snap);
    const copper = { ...snap, deposits: [{ ...snap.deposits[0], kind: "copper" as const }] };
    const copperRun = flowPaths(copper)[0];

    expect(copperRun.resource).toBe("copper");
    expect(copperRun.steps).toBe(ironRun.steps);
    expect(flowConnections(copper)).toBe(connections);
  });

  it("keeps the world topology cached while a build preview is routed", () => {
    const snap = grid(4, 1, { "0,0": E("east"), "1,0": B("east"), "2,0": B("east"), "3,0": S("west") });
    const liveRuns = flowPaths(snap);
    const liveConnections = flowConnections(snap);

    const preview = { ...snap, tiles: snap.tiles.slice() };
    flowConnections(preview);

    const depleted = { ...snap, deposits: [{ ...snap.deposits[0], remaining: 0 }] };
    const depletedRuns = flowPaths(depleted);
    expect(depletedRuns[0].active).toBe(false);
    expect(depletedRuns[0].steps).toBe(liveRuns[0].steps);
    expect(flowConnections(depleted)).toBe(liveConnections);
  });

  it("keeps resource state cached across stale connection lookups", () => {
    const snap = grid(4, 1, { "0,0": E("east"), "1,0": B("east"), "2,0": B("east"), "3,0": S("west") });
    const depleted = { ...snap, deposits: [{ ...snap.deposits[0], remaining: 0 }] };
    const depletedRuns = flowPaths(depleted);

    flowConnections(snap);

    expect(flowPaths(depleted)).toBe(depletedRuns);
    expect(depletedRuns[0].active).toBe(false);
  });

  it("updates route membership when a resource snapshot adds a deposit", () => {
    const snap = grid(4, 1, { "0,0": E("east"), "1,0": B("east"), "2,0": B("east"), "3,0": S("west") });
    const deposit = snap.deposits[0];
    const withoutDeposit = { ...snap, deposits: [] };
    expect(flowPaths(withoutDeposit)).toEqual([]);

    const restored = { ...snap, deposits: [deposit] };
    expect(flowPaths(restored)).toHaveLength(1);
    expect(flowConnections(restored).get(1)).toEqual(["east", "west"]);
  });

  it("keeps a later route aligned when an earlier deposit disappears", () => {
    const snap = grid(4, 2, {
      "0,0": E("east"),
      "1,0": B("east"),
      "2,0": B("east"),
      "3,0": S("west"),
      "0,1": E("east"),
      "1,1": B("east"),
      "2,1": B("east"),
      "3,1": S("west"),
    });
    const both = flowPaths(snap);
    const secondOnly = flowPaths({ ...snap, deposits: [snap.deposits[1]] });

    expect(secondOnly).toHaveLength(1);
    expect(secondOnly[0].source).toBe(4);
    expect(secondOnly[0].steps).toBe(both[1].steps);
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

describe("removeDrainedRuns", () => {
  it("keeps the same array until a fade finishes", () => {
    const runs = [
      { key: "live", death: null },
      { key: "cut", death: 5 },
    ];

    expect(removeDrainedRuns(runs, 5.5, 1)).toBe(runs);
  });

  it("removes expired runs without touching live ones", () => {
    const runs = [
      { key: "live", death: null },
      { key: "cut", death: 5 },
    ];

    expect(removeDrainedRuns(runs, 7, 1)).toEqual([{ key: "live", death: null }]);
  });
});
