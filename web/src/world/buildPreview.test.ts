import { describe, expect, it } from "vitest";
import type { BuildPreview } from "../net/types";
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
