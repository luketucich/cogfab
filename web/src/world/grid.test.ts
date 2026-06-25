import { describe, it, expect } from "vitest";
import { cellsBetween, dirBetween, dirFromDelta } from "./grid";

describe("dirBetween", () => {
  it("names the facing toward an adjacent cell", () => {
    expect(dirBetween({ x: 1, y: 1 }, { x: 1, y: 0 })).toBe("north");
    expect(dirBetween({ x: 1, y: 1 }, { x: 1, y: 2 })).toBe("south");
    expect(dirBetween({ x: 1, y: 1 }, { x: 2, y: 1 })).toBe("east");
    expect(dirBetween({ x: 1, y: 1 }, { x: 0, y: 1 })).toBe("west");
  });
});

describe("cellsBetween", () => {
  it("returns the single next cell for an adjacent step", () => {
    expect(cellsBetween({ x: 0, y: 0 }, { x: 1, y: 0 })).toEqual([{ x: 1, y: 0 }]);
  });

  it("fills a jump x first then y, excluding the start", () => {
    expect(cellsBetween({ x: 0, y: 0 }, { x: 2, y: 1 })).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
    ]);
  });

  it("returns nothing when start and end are the same", () => {
    expect(cellsBetween({ x: 3, y: 3 }, { x: 3, y: 3 })).toEqual([]);
  });
});

describe("dirFromDelta", () => {
  it("picks the cardinal of the larger movement", () => {
    expect(dirFromDelta(0.3, 0.1)).toBe("east");
    expect(dirFromDelta(-0.3, 0.1)).toBe("west");
    expect(dirFromDelta(0.1, 0.3)).toBe("south");
    expect(dirFromDelta(0.1, -0.3)).toBe("north");
  });
});
