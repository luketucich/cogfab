import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StateMessage, TileUpdate, TileView } from "../net/types";

const { feedbackSpy } = vi.hoisted(() => ({ feedbackSpy: vi.fn() }));
vi.mock("./placementFeedback", () => ({ showPlacementFeedback: feedbackSpy }));

import {
  applyTiles,
  clearPredictions,
  getLatest,
  getTerrain,
  predictAction,
  resetLatest,
  resolveAction,
  setLatest,
  setResources,
  subscribe,
  subscribeResources,
} from "./store";

const tile = (kind: TileView["kind"], dir: TileView["dir"] = "north"): TileView => ({ kind, dir });

function state(...tiles: TileView[]): StateMessage {
  return {
    type: "state",
    width: tiles.length,
    height: 1,
    tiles,
    deposits: [{ x: 0, y: 0, kind: "iron", capacity: 100, remaining: 100 }],
    ports: [{ x: tiles.length - 1, y: 0 }],
  };
}

function update(x: number, kind: TileView["kind"], dir: TileView["dir"] = "east"): TileUpdate {
  return { x, y: 0, kind, dir };
}

describe("world store", () => {
  beforeEach(() => {
    resetLatest();
    feedbackSpy.mockClear();
  });

  it("shows a predicted action immediately without changing authority", () => {
    setLatest(state(tile("empty")));

    expect(predictAction(1, [update(0, "belt")])).toBe(true);
    expect(getLatest()?.tiles[0]).toEqual(tile("belt", "east"));

    expect(resolveAction(1)).toBe(true);
    expect(getLatest()?.tiles[0]).toEqual(tile("empty"));
  });

  it("confirms a matching action without a second visible update", () => {
    setLatest(state(tile("empty")));
    let changes = 0;
    const off = subscribe(() => changes++);

    predictAction(1, [update(0, "belt")]);
    const predicted = getLatest();
    applyTiles({ type: "tiles", tiles: [update(0, "belt")] });
    expect(getLatest()).toBe(predicted);
    expect(changes).toBe(1);
    expect(feedbackSpy).not.toHaveBeenCalled();

    resolveAction(1);
    expect(getLatest()).toBe(predicted);
    expect(changes).toBe(1);
    off();
  });

  it("rolls back only the rejected action", () => {
    setLatest(state(tile("empty"), tile("empty")));
    predictAction(1, [update(0, "belt")]);
    predictAction(2, [update(1, "extractor")]);

    resolveAction(1);

    expect(getLatest()?.tiles).toEqual([tile("empty"), tile("extractor", "east")]);
    expect(resolveAction(99)).toBe(false);
    expect(getLatest()?.tiles).toEqual([tile("empty"), tile("extractor", "east")]);
  });

  it("keeps later actions visible while earlier actions confirm", () => {
    setLatest(state(tile("empty"), tile("empty")));
    predictAction(1, [update(0, "belt")]);
    predictAction(2, [update(1, "belt")]);

    applyTiles({ type: "tiles", tiles: [update(0, "belt")] });
    resolveAction(1);

    expect(getLatest()?.tiles).toEqual([tile("belt", "east"), tile("belt", "east")]);
    resolveAction(2);
    expect(getLatest()?.tiles).toEqual([tile("belt", "east"), tile("empty")]);
  });

  it("drops an entire predicted batch after a remote conflict", () => {
    setLatest(state(tile("empty"), tile("empty"), tile("empty")));
    predictAction(1, [update(0, "belt"), update(1, "belt"), update(2, "belt")]);

    applyTiles({ type: "tiles", tiles: [update(1, "seller", "west")] });

    expect(getLatest()?.tiles).toEqual([tile("empty"), tile("seller", "west"), tile("empty")]);
    expect(resolveAction(1)).toBe(true);
    expect(getLatest()?.tiles).toEqual([tile("empty"), tile("seller", "west"), tile("empty")]);
  });

  it("replays dependent actions in submission order", () => {
    setLatest(state(tile("empty")));
    predictAction(1, [update(0, "belt", "east")]);
    predictAction(2, [update(0, "belt", "south")]);
    expect(getLatest()?.tiles[0]).toEqual(tile("belt", "south"));

    applyTiles({ type: "tiles", tiles: [update(0, "belt", "east")] });
    resolveAction(1);
    expect(getLatest()?.tiles[0]).toEqual(tile("belt", "south"));

    applyTiles({ type: "tiles", tiles: [update(0, "belt", "south")] });
    resolveAction(2);
    expect(getLatest()?.tiles[0]).toEqual(tile("belt", "south"));
  });

  it("hides dependent actions when their prerequisite is rejected", () => {
    setLatest(state(tile("empty")));
    predictAction(1, [update(0, "belt", "east")]);
    predictAction(2, [update(0, "belt", "south")]);

    resolveAction(1);

    expect(getLatest()?.tiles[0]).toEqual(tile("empty"));
    expect(resolveAction(2)).toBe(true);
    expect(getLatest()?.tiles[0]).toEqual(tile("empty"));
  });

  it("rebases pending actions over a full snapshot", () => {
    setLatest(state(tile("empty"), tile("empty")));
    predictAction(1, [update(1, "belt")]);

    setLatest(state(tile("extractor", "south"), tile("empty")));

    expect(getLatest()?.tiles).toEqual([tile("extractor", "south"), tile("belt", "east")]);
    resolveAction(1);
    expect(getLatest()?.tiles).toEqual([tile("extractor", "south"), tile("empty")]);
  });

  it("keeps the visible reference when a full snapshot confirms a prediction", () => {
    setLatest(state(tile("empty")));
    predictAction(1, [update(0, "belt")]);
    const predicted = getLatest();
    let changes = 0;
    const off = subscribe(() => changes++);

    setLatest(state(tile("belt", "east")));
    resolveAction(1);

    expect(getLatest()).toBe(predicted);
    expect(changes).toBe(0);
    off();
  });

  it("clears predictions explicitly and on room reset", () => {
    setLatest(state(tile("empty")));
    predictAction(1, [update(0, "belt")]);
    clearPredictions();
    expect(getLatest()?.tiles[0]).toEqual(tile("empty"));

    predictAction(2, [update(0, "extractor")]);
    resetLatest();
    expect(getLatest()).toBeNull();
    setLatest(state(tile("empty")));
    expect(resolveAction(2)).toBe(false);
    expect(getLatest()?.tiles[0]).toEqual(tile("empty"));
  });

  it("rejects malformed predictions without notifying", () => {
    setLatest(state(tile("empty"), tile("empty")));
    let changes = 0;
    const off = subscribe(() => changes++);

    expect(predictAction(0, [update(0, "belt")])).toBe(false);
    expect(predictAction(1, [])).toBe(false);
    expect(predictAction(1, [update(2, "belt")])).toBe(false);
    expect(predictAction(1, [update(0, "belt"), update(0, "belt")])).toBe(false);
    expect(changes).toBe(0);
    off();
  });

  it("notifies each store once for one visible batch", () => {
    setLatest(state(tile("empty"), tile("empty")));
    let worldChanges = 0;
    let resourceChanges = 0;
    const offWorld = subscribe(() => worldChanges++);
    const offResources = subscribeResources(() => resourceChanges++);

    predictAction(1, [update(0, "belt"), update(1, "belt")]);

    expect(worldChanges).toBe(1);
    expect(resourceChanges).toBe(1);
    offWorld();
    offResources();
  });

  it("plays feedback for a remote placement once", () => {
    const world = state(tile("empty"));
    setLatest(world);

    applyTiles({ type: "tiles", tiles: [update(0, "extractor")] });

    expect(feedbackSpy).toHaveBeenCalledOnce();
    expect(feedbackSpy).toHaveBeenCalledWith(world, [update(0, "extractor")]);
  });

  it("patches resource totals without rebuilding the world snapshot", () => {
    const world = state(tile("extractor"));
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

  it("preserves resource state while applying authoritative tiles", () => {
    const world = state(tile("empty"), tile("empty"));
    setLatest(world);
    setResources({ type: "resources", deposits: [{ x: 0, y: 0, kind: "iron", capacity: 100, remaining: 42 }] });

    applyTiles({ type: "tiles", tiles: [update(0, "extractor"), update(1, "belt")] });

    expect(getLatest()?.tiles).toEqual([tile("extractor", "east"), tile("belt", "east")]);
    expect(getTerrain()?.tiles).toBe(getLatest()?.tiles);
    expect(getLatest()?.deposits[0].remaining).toBe(100);
    expect(getTerrain()?.deposits[0].remaining).toBe(42);
    expect(getTerrain()?.ports).toBe(world.ports);
  });

  it("rejects authoritative batches before a snapshot or outside the world", () => {
    applyTiles({ type: "tiles", tiles: [update(0, "belt")] });
    expect(getLatest()).toBeNull();

    const world = state(tile("empty"));
    setLatest(world);
    applyTiles({ type: "tiles", tiles: [update(0, "belt"), update(1, "belt")] });
    expect(getLatest()).toBe(world);
  });
});
