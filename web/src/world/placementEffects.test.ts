import { describe, expect, it } from "vitest";
import type { StateMessage, TileView } from "../net/types";
import { newPlacements } from "./placementEffectStore";

const state = (...tiles: TileView[]): StateMessage => ({
  type: "state",
  width: tiles.length,
  height: 1,
  tiles,
});
const tile = (kind: TileView["kind"], dir: TileView["dir"] = "east"): TileView => ({ kind, dir });

describe("newPlacements", () => {
  it("finds every empty-to-building transition", () => {
    const previous = state(tile("empty"), tile("empty"), tile("belt"));
    const next = state(tile("extractor"), tile("belt"), tile("belt"));
    expect(newPlacements(previous, next)).toEqual([
      { x: 0, y: 0, kind: "extractor", dir: "east" },
      { x: 1, y: 0, kind: "belt", dir: "east" },
    ]);
  });

  it("ignores initial loads, rotations, and destroyed tiles", () => {
    const next = state(tile("belt", "south"), tile("empty"));
    expect(newPlacements(null, next)).toEqual([]);
    expect(newPlacements(state(tile("belt", "east"), tile("seller")), next)).toEqual([]);
  });
});
