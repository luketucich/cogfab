import { describe, expect, it } from "vitest";
import { extendBuildStroke, strokePlacements } from "./buildStroke";

describe("extendBuildStroke", () => {
  it("fills a fast pointer jump without gaps", () => {
    expect(extendBuildStroke([{ x: 0, y: 0 }], { x: 2, y: 1 })).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
    ]);
  });

  it("shortens the preview when the pointer doubles back", () => {
    const cells = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ];
    expect(extendBuildStroke(cells, { x: 1, y: 0 })).toEqual(cells.slice(0, 2));
  });
});

describe("strokePlacements", () => {
  it("faces each building along the drag, including corners", () => {
    expect(
      strokePlacements(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
        "west",
        false,
      ),
    ).toEqual([
      { x: 0, y: 0, dir: "east" },
      { x: 1, y: 0, dir: "south" },
      { x: 1, y: 1, dir: "south" },
    ]);
  });

  it("uses the current aim for a click or a locked stroke", () => {
    expect(strokePlacements([{ x: 2, y: 3 }], "north", false)).toEqual([{ x: 2, y: 3, dir: "north" }]);
    expect(
      strokePlacements(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
        "south",
        true,
      ),
    ).toEqual([
      { x: 0, y: 0, dir: "south" },
      { x: 1, y: 0, dir: "south" },
    ]);
  });
});
