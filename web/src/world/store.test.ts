import { beforeEach, describe, it, expect } from "vitest";
import { applyTiles, getLatest, getTerrain, resetLatest, setLatest, setResources, subscribe, subscribeResources } from "./store";
import type { StateMessage, TileView } from "../net/types";

const snap = (kind: TileView["kind"]): StateMessage => ({
  type: "state",
  width: 1,
  height: 1,
  tiles: [{ kind, dir: "north" }],
  deposits: [{ x: 0, y: 0, kind: "iron", capacity: 100, remaining: 100 }],
  ports: [{ x: 0, y: 0 }],
});

describe("world store", () => {
  beforeEach(resetLatest);

  it("holds the latest snapshot", () => {
    setLatest(snap("belt"));
    expect(getLatest()?.tiles[0].kind).toBe("belt");

    setLatest(snap("extractor"));
    expect(getLatest()?.tiles[0].kind).toBe("extractor");
  });

  it("notifies subscribers on change and stops after unsubscribe", () => {
    let n = 0;
    const off = subscribe(() => {
      n++;
    });

    setLatest(snap("belt"));
    setLatest(snap("empty"));
    expect(n).toBe(2);

    off();
    setLatest(snap("belt"));
    expect(n).toBe(2);
  });

  it("patches resource totals without rebuilding the world snapshot", () => {
    const world = snap("extractor");
    setLatest(world);
    let worldChanges = 0;
    let resourceChanges = 0;
    const offWorld = subscribe(() => worldChanges++);
    const offResources = subscribeResources(() => resourceChanges++);

    setResources({ type: "resources", deposits: [{ x: 0, y: 0, kind: "iron", capacity: 100, remaining: 42 }] });

    expect(getLatest()).toBe(world);
    expect(getLatest()?.deposits[0].remaining).toBe(100);
    expect(getTerrain()).not.toBe(world);
    expect(getTerrain()?.deposits[0].remaining).toBe(42);
    expect(getTerrain()?.tiles).toBe(world.tiles);
    expect(getTerrain()?.ports).toBe(world.ports);
    expect(worldChanges).toBe(0);
    expect(resourceChanges).toBe(1);
    offWorld();
    offResources();
  });

  it("applies a tile batch once while preserving resource state", () => {
    const world = {
      ...snap("empty"),
      width: 2,
      tiles: [
        { kind: "empty", dir: "north" },
        { kind: "empty", dir: "north" },
      ] as TileView[],
    };
    setLatest(world);
    setResources({ type: "resources", deposits: [{ x: 0, y: 0, kind: "iron", capacity: 100, remaining: 42 }] });
    let worldChanges = 0;
    let resourceChanges = 0;
    const offWorld = subscribe(() => worldChanges++);
    const offResources = subscribeResources(() => resourceChanges++);

    applyTiles({
      type: "tiles",
      tiles: [
        { x: 0, y: 0, kind: "extractor", dir: "east" },
        { x: 1, y: 0, kind: "belt", dir: "east" },
      ],
    });

    expect(getLatest()?.tiles).toEqual([
      { kind: "extractor", dir: "east" },
      { kind: "belt", dir: "east" },
    ]);
    expect(getTerrain()?.tiles).toBe(getLatest()?.tiles);
    expect(getLatest()?.deposits[0].remaining).toBe(100);
    expect(getTerrain()?.deposits[0].remaining).toBe(42);
    expect(getTerrain()?.ports).toBe(world.ports);
    expect(worldChanges).toBe(1);
    expect(resourceChanges).toBe(1);
    offWorld();
    offResources();
  });

  it("rejects tile batches before a snapshot or outside the world", () => {
    applyTiles({ type: "tiles", tiles: [{ x: 0, y: 0, kind: "belt", dir: "east" }] });
    expect(getLatest()).toBeNull();

    const world = snap("empty");
    setLatest(world);
    applyTiles({
      type: "tiles",
      tiles: [
        { x: 0, y: 0, kind: "belt", dir: "east" },
        { x: 1, y: 0, kind: "belt", dir: "east" },
      ],
    });
    expect(getLatest()).toBe(world);
  });
});
