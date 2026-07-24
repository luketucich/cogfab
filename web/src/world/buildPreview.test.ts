import { describe, expect, it } from "vitest";
import type { BuildPreview, StateMessage } from "../net/types";
import {
  continuousPlacementPaths,
  previewSnapshot,
  resolvePlacementDirections,
  visibleBuildPreview,
} from "./buildPreviewData";
import { buildPreviewsEqual } from "./buildPreviewStore";

const preview = (x = 1): BuildPreview => ({
  kind: "belt",
  placements: [{ x, y: 2, dir: "east" }],
});

describe("buildPreviewsEqual", () => {
  it("matches previews by value instead of object identity", () => {
    expect(buildPreviewsEqual(preview(), preview())).toBe(true);
  });

  it("detects changed cells, directions, kinds, and clears", () => {
    expect(buildPreviewsEqual(preview(), preview(2))).toBe(false);
    expect(buildPreviewsEqual(preview(), { ...preview(), placements: [{ x: 1, y: 2, dir: "south" }] })).toBe(false);
    expect(buildPreviewsEqual(preview(), { kind: "seller", placements: preview().placements })).toBe(false);
    expect(buildPreviewsEqual(preview(), null)).toBe(false);
    expect(buildPreviewsEqual(null, null)).toBe(true);
  });
});

describe("build preview rendering data", () => {
  const snap: StateMessage = {
    type: "state",
    width: 4,
    height: 1,
    tiles: [
      { kind: "empty", dir: "east" },
      { kind: "extractor", dir: "north" },
      { kind: "empty", dir: "east" },
      { kind: "empty", dir: "east" },
    ],
    deposits: [{ x: 0, y: 0, kind: "iron", capacity: 100, remaining: 100 }],
    ports: [{ x: 3, y: 0 }],
  };

  it("does not render ghosts over placed buildings or outside the grid", () => {
    const mixed: BuildPreview = {
      kind: "belt",
      placements: [
        { x: 2, y: 0, dir: "east" },
        { x: 1, y: 0, dir: "east" },
        { x: 4, y: 0, dir: "east" },
      ],
    };
    expect(visibleBuildPreview(mixed, snap)).toEqual({
      kind: "belt",
      placements: [{ x: 2, y: 0, dir: "east" }],
    });
  });

  it("overlays preview belts without changing the server snapshot", () => {
    const path: BuildPreview = {
      kind: "belt",
      placements: [
        { x: 0, y: 0, dir: "east" },
        { x: 2, y: 0, dir: "south" },
      ],
    };
    const overlaid = previewSnapshot(path, snap);
    expect(overlaid.tiles[0]).toEqual({ kind: "belt", dir: "east" });
    expect(overlaid.tiles[2]).toEqual({ kind: "belt", dir: "south" });
    expect(snap.tiles[0].kind).toBe("empty");
  });

  it("hides machine ghosts from invalid terrain", () => {
    const extractor: BuildPreview = {
      kind: "extractor",
      placements: [
        { x: 0, y: 0, dir: "east" },
        { x: 3, y: 0, dir: "east" },
      ],
    };
    const seller: BuildPreview = { kind: "seller", placements: extractor.placements };
    expect(visibleBuildPreview(extractor, snap)?.placements).toEqual([extractor.placements[0]]);
    expect(visibleBuildPreview(seller, snap)?.placements).toEqual([seller.placements[1]]);
  });

  it("hides belt ghosts on live deposits and shipping ports", () => {
    const belt: BuildPreview = {
      kind: "belt",
      placements: [
        { x: 0, y: 0, dir: "east" },
        { x: 2, y: 0, dir: "east" },
        { x: 3, y: 0, dir: "east" },
      ],
    };
    expect(visibleBuildPreview(belt, snap)?.placements).toEqual([belt.placements[1]]);
  });

  it("shows a refiner over a belt and inherits its routed alignment instead of its facing", () => {
    const withBelt = {
      ...snap,
      tiles: [
        { kind: "extractor" as const, dir: "east" as const },
        { kind: "belt" as const, dir: "south" as const },
        { kind: "belt" as const, dir: "south" as const },
        { kind: "seller" as const, dir: "west" as const },
      ],
    };
    const refiner: BuildPreview = {
      kind: "refiner",
      placements: [{ x: 2, y: 0, dir: "north" }],
    };
    const placements = resolvePlacementDirections(refiner.kind, refiner.placements, withBelt);

    expect(placements).toEqual([{ x: 2, y: 0, dir: "east" }]);
    expect(visibleBuildPreview({ ...refiner, placements }, withBelt)?.placements).toEqual(placements);
  });

  it("does not offer a straight refiner over a belt corner", () => {
    const corner: StateMessage = {
      type: "state",
      width: 3,
      height: 3,
      tiles: [
        { kind: "extractor", dir: "east" },
        { kind: "belt", dir: "east" },
        { kind: "belt", dir: "south" },
        { kind: "empty", dir: "north" },
        { kind: "empty", dir: "north" },
        { kind: "belt", dir: "south" },
        { kind: "empty", dir: "north" },
        { kind: "empty", dir: "north" },
        { kind: "seller", dir: "north" },
      ],
      deposits: [{ x: 0, y: 0, kind: "iron", capacity: 100, remaining: 100 }],
      ports: [{ x: 2, y: 2 }],
    };
    const refiner: BuildPreview = {
      kind: "refiner",
      placements: [{ x: 2, y: 0, dir: "south" }],
    };

    expect(visibleBuildPreview(refiner, corner)).toBeNull();
  });

  it("keeps a turning build stroke in one continuous path", () => {
    const turn: BuildPreview = {
      kind: "belt",
      placements: [
        { x: 0, y: 0, dir: "east" },
        { x: 1, y: 0, dir: "east" },
        { x: 1, y: 1, dir: "south" },
        { x: 1, y: 2, dir: "south" },
      ],
    };
    expect(continuousPlacementPaths(turn.placements)).toEqual([turn.placements]);
  });

  it("starts a new path instead of drawing through a gap", () => {
    const placements = [
      { x: 0, y: 0, dir: "east" as const },
      { x: 1, y: 0, dir: "east" as const },
      { x: 3, y: 0, dir: "east" as const },
    ];
    expect(continuousPlacementPaths(placements)).toEqual([placements.slice(0, 2), placements.slice(2)]);
  });
});
