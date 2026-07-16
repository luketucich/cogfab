import type { Dir, StateMessage } from "../net/types";
import { OPPOSITE, SIDES, STEP } from "./dir";
import { cellIndex } from "./grid";

// neighbour is the tiles index of the cell one step from i toward s, or -1 off
// the grid.
const neighbour = (snap: StateMessage, i: number, s: Dir): number => {
  const x = i % snap.width;
  const y = Math.floor(i / snap.width);
  const [dx, dy] = STEP[s];
  return cellIndex(snap, x + dx, y + dy);
};

// FlowStep is one belt on a run: the cell and the sides ore enters and leaves by
// (opposite sides run straight, perpendicular sides curve).
export type FlowStep = { x: number; y: number; entry: Dir; exit: Dir };

// FlowRun is one extractor's belt run: the ordered cells ore travels, and whether
// it reaches a seller (complete) or dead-ends (broken). Both the flowing ore and
// the path arrows are built from these, so they always agree.
export type FlowRun = { steps: FlowStep[]; complete: boolean };

// flowPaths returns a run for the belt at each extractor's mouth: the shortest
// path to a seller's mouth when one is reachable (complete), otherwise the path to
// the farthest belt (broken). Ore leaves an extractor and enters a seller only on
// the side each faces; between belts facing does not gate flow, so the run is just
// the connected path the ore travels.
//
// Ore, arrows, and belt models share the cached result for each snapshot, so a
// world change walks the grid once.
let cachedSnap: StateMessage | null = null;
let cachedRuns: FlowRun[] = [];
let cachedConnections: ReadonlyMap<number, readonly Dir[]> = new Map();

function refreshFlow(snap: StateMessage): void {
  if (snap === cachedSnap) return;
  cachedRuns = computeFlowPaths(snap);
  cachedConnections = connectionsFor(snap, cachedRuns);
  cachedSnap = snap;
}

export function flowPaths(snap: StateMessage): FlowRun[] {
  refreshFlow(snap);
  return cachedRuns;
}

// flowConnections returns the sides ore crosses on each routed belt. Belt
// models use the same answer as the moving ore, including machine endpoints.
export function flowConnections(snap: StateMessage): ReadonlyMap<number, readonly Dir[]> {
  refreshFlow(snap);
  return cachedConnections;
}

function connectionsFor(snap: StateMessage, runs: FlowRun[]): ReadonlyMap<number, readonly Dir[]> {
  const collected = new Map<number, Set<Dir>>();
  for (const run of runs) {
    for (const step of run.steps) {
      const index = step.y * snap.width + step.x;
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

function computeFlowPaths(snap: StateMessage): FlowRun[] {
  const w = snap.width;
  const tiles = snap.tiles;
  const runs: FlowRun[] = [];

  const dirTo = (from: number, to: number): Dir => {
    const fx = from % w;
    const tx = to % w;
    if (tx > fx) return "east";
    if (tx < fx) return "west";
    return to > from ? "south" : "north";
  };

  // route walks belts out from a source belt: it heads for the nearest seller, or
  // failing that the farthest belt, and returns the ordered path either way.
  const route = (start: number, fromExtractor: Dir): FlowRun => {
    const prev = new Map<number, number>();
    const seen = new Set<number>([start]);
    const queue = [start];
    let sellerCell = -1;
    let sellerDir: Dir = "north";
    let farthest = start;
    while (queue.length) {
      const cur = queue.shift()!;
      farthest = cur; // breadth-first, so the last cell dequeued is the deepest
      let done = false;
      for (const s of SIDES) {
        const n = neighbour(snap, cur, s);
        if (n < 0) continue;
        // a seller only takes ore on the side it faces, so the belt must sit at its
        // mouth (the seller faces back toward this belt), not just touch a side
        if (tiles[n].kind === "seller" && tiles[n].dir === OPPOSITE[s]) {
          sellerCell = cur;
          sellerDir = s;
          done = true;
          break;
        }
        if (tiles[n].kind === "belt" && !seen.has(n)) {
          seen.add(n);
          prev.set(n, cur);
          queue.push(n);
        }
      }
      if (done) break;
    }

    const complete = sellerCell >= 0;
    const order = [complete ? sellerCell : farthest];
    let c = order[0];
    while (c !== start) {
      c = prev.get(c)!;
      order.push(c);
    }
    order.reverse();

    const steps = order.map((cur, k) => {
      const entry = k === 0 ? fromExtractor : dirTo(cur, order[k - 1]);
      const last = k === order.length - 1;
      const exit = last ? (complete ? sellerDir : OPPOSITE[entry]) : dirTo(cur, order[k + 1]);
      return { x: cur % w, y: Math.floor(cur / w), entry, exit };
    });
    return { steps, complete };
  };

  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i].kind !== "extractor") continue;
    // ore leaves an extractor only from the side it faces, so the run starts at the
    // belt at its mouth, not a belt touching a side
    const out = tiles[i].dir;
    const b = neighbour(snap, i, out);
    if (b >= 0 && tiles[b].kind === "belt") runs.push(route(b, OPPOSITE[out]));
  }
  return runs;
}

// runKey identifies a run by its ordered cells and the sides ore crosses them,
// so the ore and arrows can tell a path that is still flowing from a brand new
// one. The sides matter: two extractors can feed the same belts from different
// ends, and those runs must not collide.
export const runKey = (run: FlowRun): string =>
  run.steps.map((s) => `${s.x},${s.y},${s.entry},${s.exit}`).join(";");

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
