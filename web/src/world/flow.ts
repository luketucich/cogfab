import type { Dir, ResourceKind, StateMessage } from "../net/types";
import { OPPOSITE, sameAxis, SIDES, STEP } from "./dir";
import { cellIndex } from "./grid";
import { depositAt } from "./resources";

// neighbour is the tile index one step from a cell, or -1 past the grid edge.
const neighbour = (snap: StateMessage, index: number, side: Dir): number => {
  const x = index % snap.width;
  const y = Math.floor(index / snap.width);
  const [dx, dy] = STEP[side];
  return cellIndex(snap, x + dx, y + dy);
};

// FlowStep is one cell on a run: the cell and the sides material enters and leaves by
// (opposite sides run straight, perpendicular sides curve). Refiners sit in the path.
export type FlowStep = { x: number; y: number; entry: Dir; exit: Dir };

// FlowRun is one extractor's belt run. Source keeps separate extractors distinct
// when they share a path; active is false once that source deposit is empty.
export type FlowRun = {
  steps: FlowStep[];
  complete: boolean;
  source: number;
  resource: ResourceKind;
  active: boolean;
};

type FlowTopologyRun = Pick<FlowRun, "steps" | "complete" | "source">;
type DepositMembership = { width: number; key: string; sources: Set<number> };

// flowPaths returns a run for the belt at each extractor's mouth: the shortest
// path to a seller's mouth when one is reachable (complete), otherwise the path to
// the farthest conveying cell (broken). Material leaves an extractor and enters
// a seller only on the side each faces. Refiners are straight inline processors:
// either end of their horizontal or vertical axis can become the input. Belt
// facing never gates flow.
//
// Material, arrows, and belt models share this result. Resource updates keep the
// same tile array, so they reuse the routed steps and only refresh run state.
// Preview tile arrays get their own entries and can be collected when discarded.
type FlowCache = {
  width: number;
  height: number;
  topology: FlowTopologyRun[];
  runsSnap: StateMessage | null;
  runs: FlowRun[];
  connectionMembership: string | null;
  connections: ReadonlyMap<number, readonly Dir[]>;
};

const flowCache = new WeakMap<StateMessage["tiles"], FlowCache>();
const depositMembershipCache = new WeakMap<StateMessage["deposits"], DepositMembership>();

function depositMembershipFor(snap: StateMessage): DepositMembership {
  const cached = depositMembershipCache.get(snap.deposits);
  if (cached?.width === snap.width) return cached;

  const sourceList = snap.deposits.map((deposit) => deposit.y * snap.width + deposit.x);
  const membership = { width: snap.width, key: sourceList.join(","), sources: new Set(sourceList) };
  depositMembershipCache.set(snap.deposits, membership);
  return membership;
}

function topologyFor(snap: StateMessage): FlowCache {
  let cache = flowCache.get(snap.tiles);
  if (!cache || cache.width !== snap.width || cache.height !== snap.height) {
    cache = {
      width: snap.width,
      height: snap.height,
      topology: computeFlowTopology(snap),
      runsSnap: null,
      runs: [],
      connectionMembership: null,
      connections: new Map(),
    };
    flowCache.set(snap.tiles, cache);
  }
  return cache;
}

export function flowPaths(snap: StateMessage): FlowRun[] {
  const cache = topologyFor(snap);
  if (snap !== cache.runsSnap) {
    cache.runs = runsFor(snap, cache.topology, cache.runs);
    cache.runsSnap = snap;
  }
  return cache.runs;
}

// flowConnections returns the sides material crosses on each routed belt. Belt
// models use the same answer as the moving material, including machine endpoints.
export function flowConnections(snap: StateMessage): ReadonlyMap<number, readonly Dir[]> {
  const cache = topologyFor(snap);
  const membership = depositMembershipFor(snap);
  if (membership.key !== cache.connectionMembership) {
    cache.connections = connectionsFor(
      snap,
      cache.topology.filter((route) => membership.sources.has(route.source)),
    );
    cache.connectionMembership = membership.key;
  }
  return cache.connections;
}

function connectionsFor(snap: StateMessage, runs: FlowTopologyRun[]): ReadonlyMap<number, readonly Dir[]> {
  const collected = new Map<number, Set<Dir>>();
  for (const run of runs) {
    for (const step of run.steps) {
      const index = step.y * snap.width + step.x;
      if (snap.tiles[index]?.kind !== "belt") continue;
      const sides = collected.get(index) ?? new Set<Dir>();
      sides.add(step.entry);
      sides.add(step.exit);
      collected.set(index, sides);
    }
  }

  const connections = new Map<number, readonly Dir[]>();
  for (const [index, sides] of collected) {
    connections.set(
      index,
      SIDES.filter((side) => sides.has(side)),
    );
  }
  return connections;
}

function runsFor(snap: StateMessage, topology: FlowTopologyRun[], previous: FlowRun[]): FlowRun[] {
  const runs: FlowRun[] = [];
  for (const route of topology) {
    const source = depositAt(snap, route.source % snap.width, Math.floor(route.source / snap.width));
    if (!source) continue;

    const active = source.remaining > 0;
    const prior = previous[runs.length];
    if (
      prior?.source === route.source &&
      prior.steps === route.steps &&
      prior.complete === route.complete &&
      prior.resource === source.kind &&
      prior.active === active
    ) {
      runs.push(prior);
    } else {
      runs.push({ ...route, resource: source.kind, active });
    }
  }

  if (runs.length === previous.length && runs.every((run, index) => run === previous[index])) return previous;
  return runs;
}

function computeFlowTopology(snap: StateMessage): FlowTopologyRun[] {
  const width = snap.width;
  const tiles = snap.tiles;
  const runs: FlowTopologyRun[] = [];

  // Every complete route shares one distance field over belts and refiners.
  // Broken routes still need their own search because the farthest conveying
  // cell depends on where they start.
  const sellerDistance = new Int32Array(tiles.length);
  const previous = new Int32Array(tiles.length);
  const seen = new Int32Array(tiles.length);
  const queue = new Int32Array(tiles.length);
  sellerDistance.fill(-1);
  let visit = 0;

  const dirTo = (from: number, to: number): Dir => {
    const fromX = from % width;
    const toX = to % width;
    if (toX > fromX) return "east";
    if (toX < fromX) return "west";
    return to > from ? "south" : "north";
  };

  const isConveying = (index: number): boolean => {
    const kind = tiles[index]?.kind;
    return kind === "belt" || kind === "refiner";
  };

  // Belts connect on every side. A refiner connects only on its straight axis,
  // but both ends are equivalent, so its stored direction has no polarity.
  const connectsOn = (index: number, side: Dir): boolean => {
    if (!isConveying(index)) return false;
    return tiles[index].kind === "belt" || sameAxis(tiles[index].dir, side);
  };

  const conveyingEdge = (from: number, to: number, side: Dir): boolean =>
    isConveying(to) && connectsOn(from, side) && connectsOn(to, OPPOSITE[side]);

  const runFor = (
    cells: number[],
    complete: boolean,
    sellerDir: Dir,
    fromExtractor: Dir,
    source: number,
  ): FlowTopologyRun => {
    const steps = cells.map((cell, position) => {
      const entry = position === 0 ? fromExtractor : dirTo(cell, cells[position - 1]);
      const last = position === cells.length - 1;
      const exit = last ? (complete ? sellerDir : OPPOSITE[entry]) : dirTo(cell, cells[position + 1]);
      return { x: cell % width, y: Math.floor(cell / width), entry, exit };
    });
    return { steps, complete, source };
  };

  const enqueueSellerReachable = (index: number, distance: number) => {
    if (sellerDistance[index] >= 0) return;
    sellerDistance[index] = distance;
    queue[tail++] = index;
  };

  let head = 0;
  let tail = 0;
  for (let index = 0; index < tiles.length; index++) {
    if (!isConveying(index)) continue;
    for (const side of SIDES) {
      if (!connectsOn(index, side)) continue;
      const next = neighbour(snap, index, side);
      if (next >= 0 && tiles[next].kind === "seller" && tiles[next].dir === OPPOSITE[side]) {
        enqueueSellerReachable(index, 0);
        break;
      }
    }
  }
  while (head < tail) {
    const current = queue[head++];
    for (const side of SIDES) {
      const next = neighbour(snap, current, side);
      if (next >= 0 && conveyingEdge(current, next, side)) {
        enqueueSellerReachable(next, sellerDistance[current] + 1);
      }
    }
  }

  // Following the first side that gets one step closer preserves the original
  // north, east, south, west tie order without searching once per extractor.
  const completeRoute = (start: number, fromExtractor: Dir, source: number): FlowTopologyRun => {
    const cells = [start];
    let current = start;
    while (sellerDistance[current] > 0) {
      let next = -1;
      for (const side of SIDES) {
        const candidate = neighbour(snap, current, side);
        if (
          candidate >= 0 &&
          sellerDistance[candidate] === sellerDistance[current] - 1 &&
          conveyingEdge(current, candidate, side)
        ) {
          next = candidate;
          break;
        }
      }
      if (next < 0) throw new Error("seller distance has no next conveying cell");
      current = next;
      cells.push(current);
    }

    let sellerDir: Dir = "north";
    for (const side of SIDES) {
      if (!connectsOn(current, side)) continue;
      const next = neighbour(snap, current, side);
      if (next >= 0 && tiles[next].kind === "seller" && tiles[next].dir === OPPOSITE[side]) {
        sellerDir = side;
        break;
      }
    }
    return runFor(cells, true, sellerDir, fromExtractor, source);
  };

  const brokenRoute = (start: number, fromExtractor: Dir, source: number): FlowTopologyRun => {
    visit += 1;
    head = 0;
    tail = 0;
    queue[tail++] = start;
    seen[start] = visit;
    let farthest = start;
    while (head < tail) {
      const current = queue[head++];
      farthest = current; // breadth-first, so the last cell dequeued is the deepest
      for (const side of SIDES) {
        const next = neighbour(snap, current, side);
        if (next >= 0 && seen[next] !== visit && conveyingEdge(current, next, side)) {
          seen[next] = visit;
          previous[next] = current;
          queue[tail++] = next;
        }
      }
    }

    const cells = [farthest];
    let current = farthest;
    while (current !== start) {
      current = previous[current];
      cells.push(current);
    }
    cells.reverse();
    return runFor(cells, false, "north", fromExtractor, source);
  };

  for (let index = 0; index < tiles.length; index++) {
    if (tiles[index].kind !== "extractor") continue;
    // Material leaves an extractor only from the side it faces. Replacing that
    // mouth belt with an axis-aligned refiner keeps the same route alive.
    const out = tiles[index].dir;
    const start = neighbour(snap, index, out);
    if (start < 0 || !connectsOn(start, OPPOSITE[out])) continue;
    const route = sellerDistance[start] >= 0 ? completeRoute : brokenRoute;
    runs.push(route(start, OPPOSITE[out], index));
  }
  return runs;
}

// runKey identifies a run by its ordered cells and the sides material crosses,
// so the material and arrows can tell a path that is still flowing from a new
// one. The sides matter: two extractors can feed the same belts from different
// ends, and those runs must not collide.
export const runKey = (run: FlowRun): string =>
  `${run.source}:${run.resource}:` + run.steps.map((s) => `${s.x},${s.y},${s.entry},${s.exit}`).join(";");

// drainRuns merges this frame's live runs with ones whose belts just went away. A
// vanished run is stamped with when it was cut and kept flowing until it has had
// `drainSeconds` to empty out, then dropped. The arrows use this to keep a deleted
// run's chevrons fading instead of snapping off the instant a belt is gone.
export function drainRuns<T extends { key: string; death: number | null }>(
  previous: T[],
  live: T[],
  now: number,
  drainSeconds: number,
): T[] {
  const liveKeys = new Set(live.map((r) => r.key));
  const next = [...live];
  for (const run of previous) {
    if (liveKeys.has(run.key)) continue;
    const death = run.death ?? now;
    if (now - death <= drainSeconds) next.push({ ...run, death });
  }
  return next;
}

// removeDrainedRuns drops visual runs once their fade has finished. It returns
// the same array while nothing has expired, avoiding a per-frame allocation.
export function removeDrainedRuns<T extends { death: number | null }>(
  runs: T[],
  now: number,
  drainSeconds: number,
): T[] {
  const expired = runs.some((run) => run.death !== null && now - run.death > drainSeconds);
  if (!expired) return runs;
  return runs.filter((run) => run.death === null || now - run.death <= drainSeconds);
}
