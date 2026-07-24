import { describe, expect, it } from "vitest";
import type { Dir, ResourceKind, StateMessage, TileView } from "../net/types";
import { OPPOSITE, sameAxis, SIDES, STEP } from "./dir";
import { flowPaths, type FlowRun } from "./flow";

const neighbour = (snap: StateMessage, index: number, side: Dir): number => {
  const x = index % snap.width;
  const y = Math.floor(index / snap.width);
  const [dx, dy] = STEP[side];
  const nx = x + dx;
  const ny = y + dy;
  return nx < 0 || ny < 0 || nx >= snap.width || ny >= snap.height ? -1 : ny * snap.width + nx;
};

const isConveying = (tile: TileView): boolean => tile.kind === "belt" || tile.kind === "refiner";

const connectsOn = (tile: TileView, side: Dir): boolean =>
  tile.kind === "belt" || (tile.kind === "refiner" && sameAxis(tile.dir, side));

// This straightforward per-extractor search stays test-only so the optimized
// shared-distance routing can be checked against an independent reference.
function legacyFlowPaths(snap: StateMessage): FlowRun[] {
  const deposits = new Map(snap.deposits.map((deposit) => [deposit.y * snap.width + deposit.x, deposit]));
  const runs: FlowRun[] = [];

  const dirTo = (from: number, to: number): Dir => {
    const fromX = from % snap.width;
    const toX = to % snap.width;
    if (toX > fromX) return "east";
    if (toX < fromX) return "west";
    return to > from ? "south" : "north";
  };

  const route = (start: number, fromExtractor: Dir, source: number): FlowRun => {
    const previous = new Map<number, number>();
    const seen = new Set([start]);
    const queue = [start];
    let sellerCell = -1;
    let sellerDir: Dir = "north";
    let farthest = start;

    while (queue.length > 0) {
      const current = queue.shift()!;
      farthest = current;
      let complete = false;
      for (const side of SIDES) {
        if (!connectsOn(snap.tiles[current], side)) continue;
        const next = neighbour(snap, current, side);
        if (next < 0) continue;
        if (snap.tiles[next].kind === "seller" && snap.tiles[next].dir === OPPOSITE[side]) {
          sellerCell = current;
          sellerDir = side;
          complete = true;
          break;
        }
        if (isConveying(snap.tiles[next]) && connectsOn(snap.tiles[next], OPPOSITE[side]) && !seen.has(next)) {
          seen.add(next);
          previous.set(next, current);
          queue.push(next);
        }
      }
      if (complete) break;
    }

    const complete = sellerCell >= 0;
    const order = [complete ? sellerCell : farthest];
    for (let current = order[0]; current !== start; ) {
      current = previous.get(current)!;
      order.push(current);
    }
    order.reverse();

    const deposit = deposits.get(source)!;
    const steps = order.map((current, index) => {
      const entry = index === 0 ? fromExtractor : dirTo(current, order[index - 1]);
      const last = index === order.length - 1;
      const exit = last ? (complete ? sellerDir : OPPOSITE[entry]) : dirTo(current, order[index + 1]);
      return { x: current % snap.width, y: Math.floor(current / snap.width), entry, exit };
    });
    return { steps, complete, source, resource: deposit.kind, active: deposit.remaining > 0 };
  };

  for (let index = 0; index < snap.tiles.length; index++) {
    const tile = snap.tiles[index];
    if (tile.kind !== "extractor" || !deposits.has(index)) continue;
    const start = neighbour(snap, index, tile.dir);
    if (start >= 0 && isConveying(snap.tiles[start]) && connectsOn(snap.tiles[start], OPPOSITE[tile.dir])) {
      runs.push(route(start, OPPOSITE[tile.dir], index));
    }
  }
  return runs;
}

const empty = (): TileView => ({ kind: "empty", dir: "north" });

function grid(width: number, height: number, cells: Record<string, TileView>): StateMessage {
  const tiles = Array.from({ length: width * height }, empty);
  const deposits: StateMessage["deposits"] = [];
  for (const [cell, tile] of Object.entries(cells)) {
    const [x, y] = cell.split(",").map(Number);
    tiles[y * width + x] = tile;
    if (tile.kind === "extractor") deposits.push({ x, y, kind: "iron", capacity: 100, remaining: 100 });
  }
  return { type: "state", width, height, tiles, deposits, ports: [] };
}

const tile = (kind: TileView["kind"], dir: Dir): TileView => ({ kind, dir });

function seededRandom(seed: number): () => number {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function randomState(random: () => number): StateMessage {
  const width = 2 + Math.floor(random() * 7);
  const height = 2 + Math.floor(random() * 7);
  const tiles = Array.from({ length: width * height }, empty);
  const deposits: StateMessage["deposits"] = [];
  const resources: ResourceKind[] = ["iron", "copper", "quartz", "gold"];

  for (let index = 0; index < tiles.length; index++) {
    const roll = random();
    const dir = SIDES[Math.floor(random() * SIDES.length)];
    if (roll < 0.48) {
      tiles[index] = tile("belt", dir);
    } else if (roll < 0.59) {
      tiles[index] = tile("extractor", dir);
      if (random() < 0.8) {
        deposits.push({
          x: index % width,
          y: Math.floor(index / width),
          kind: resources[Math.floor(random() * resources.length)],
          capacity: 100,
          remaining: random() < 0.2 ? 0 : 100,
        });
      }
    } else if (roll < 0.70) {
      tiles[index] = tile("seller", dir);
    } else if (roll < 0.80) {
      tiles[index] = tile("refiner", dir);
    }
  }
  return { type: "state", width, height, tiles, deposits, ports: [] };
}

describe("flow route compatibility", () => {
  it("keeps the complete-route tie order", () => {
    const snap = grid(7, 3, {
      "0,1": tile("seller", "east"),
      "1,1": tile("belt", "east"),
      "2,1": tile("belt", "east"),
      "3,1": tile("belt", "east"),
      "4,1": tile("belt", "east"),
      "5,1": tile("belt", "east"),
      "6,1": tile("seller", "west"),
      "3,2": tile("extractor", "north"),
    });

    expect(flowPaths(snap)).toEqual(legacyFlowPaths(snap));
    expect(flowPaths(snap)[0].steps.map(({ x, y }) => [x, y])).toEqual([
      [3, 1],
      [4, 1],
      [5, 1],
    ]);
  });

  it("keeps the broken-route farthest tie order", () => {
    const snap = grid(7, 3, {
      "1,1": tile("belt", "east"),
      "2,1": tile("belt", "east"),
      "3,1": tile("belt", "east"),
      "4,1": tile("belt", "east"),
      "5,1": tile("belt", "east"),
      "3,2": tile("extractor", "north"),
    });

    expect(flowPaths(snap)).toEqual(legacyFlowPaths(snap));
    expect(flowPaths(snap)[0].steps.map(({ x, y }) => [x, y])).toEqual([
      [3, 1],
      [2, 1],
      [1, 1],
    ]);
  });

  it("matches the reference search across deterministic random worlds", () => {
    const random = seededRandom(0xc09fab);
    for (let sample = 0; sample < 2_000; sample++) {
      const snap = randomState(random);
      expect(flowPaths(snap), `sample ${sample}`).toEqual(legacyFlowPaths(snap));
    }
  });
});
