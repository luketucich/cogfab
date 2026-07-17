import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StateMessage, TileView } from "../net/types";

const { burstSpy, placeSpy } = vi.hoisted(() => ({ burstSpy: vi.fn(), placeSpy: vi.fn() }));
vi.mock("./burst", () => ({ addBurst: burstSpy }));
vi.mock("../sfx", () => ({ sfx: { place: placeSpy } }));

import { newPlacements, showPlacementFeedback } from "./placementFeedback";

const state = (...tiles: TileView[]): StateMessage => ({
  type: "state",
  width: tiles.length,
  height: 1,
  tiles,
  deposits: [],
  ports: [],
});
const tile = (kind: TileView["kind"], dir: TileView["dir"] = "east"): TileView => ({ kind, dir });

describe("placement feedback", () => {
  beforeEach(() => {
    burstSpy.mockClear();
    placeSpy.mockClear();
  });

  it("finds every empty-to-building transition", () => {
    const previous = state(tile("empty"), tile("empty"), tile("belt"));
    const next = state(tile("extractor"), tile("belt"), tile("belt"));
    expect(newPlacements(previous, next)).toEqual([
      { x: 0, y: 0, kind: "extractor" },
      { x: 1, y: 0, kind: "belt" },
    ]);
  });

  it("adds immediate bursts and one sound for a placement batch", () => {
    const previous = state(tile("empty"), tile("empty"));
    const next = state(tile("extractor"), tile("belt"));
    showPlacementFeedback(previous, next);
    expect(burstSpy).toHaveBeenCalledTimes(2);
    expect(burstSpy).toHaveBeenNthCalledWith(1, expect.objectContaining({ radius: 0.62, count: 12 }));
    expect(burstSpy).toHaveBeenNthCalledWith(2, expect.objectContaining({ radius: 0.38, count: 7 }));
    expect(placeSpy).toHaveBeenCalledTimes(1);
  });

  it("ignores initial loads, rotations, and destroyed tiles", () => {
    const next = state(tile("belt", "south"), tile("empty"));
    expect(newPlacements(null, next)).toEqual([]);
    expect(newPlacements(state(tile("belt", "east"), tile("seller")), next)).toEqual([]);
    showPlacementFeedback(null, next);
    expect(burstSpy).not.toHaveBeenCalled();
    expect(placeSpy).not.toHaveBeenCalled();
  });
});
