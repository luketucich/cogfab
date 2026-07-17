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
    expect(
      newPlacements(previous, [
        { x: 0, y: 0, kind: "extractor", dir: "east" },
        { x: 1, y: 0, kind: "belt", dir: "east" },
        { x: 2, y: 0, kind: "belt", dir: "south" },
      ]),
    ).toEqual([
      { x: 0, y: 0, kind: "extractor" },
      { x: 1, y: 0, kind: "belt" },
    ]);
  });

  it("adds immediate bursts and one sound for a placement batch", () => {
    const previous = state(tile("empty"), tile("empty"));
    showPlacementFeedback(previous, [
      { x: 0, y: 0, kind: "extractor", dir: "east" },
      { x: 1, y: 0, kind: "belt", dir: "east" },
    ]);
    expect(burstSpy).toHaveBeenCalledTimes(2);
    expect(burstSpy).toHaveBeenNthCalledWith(1, expect.objectContaining({ radius: 0.62, count: 12 }));
    expect(burstSpy).toHaveBeenNthCalledWith(2, expect.objectContaining({ radius: 0.38, count: 7 }));
    expect(placeSpy).toHaveBeenCalledTimes(1);
  });

  it("ignores rotations and destroyed tiles", () => {
    const previous = state(tile("belt", "east"), tile("seller"));
    const entries = [
      { x: 0, y: 0, kind: "belt", dir: "south" },
      { x: 1, y: 0, kind: "empty", dir: "north" },
    ] as const;
    expect(newPlacements(previous, [...entries])).toEqual([]);
    showPlacementFeedback(previous, [...entries]);
    expect(burstSpy).not.toHaveBeenCalled();
    expect(placeSpy).not.toHaveBeenCalled();
  });
});
