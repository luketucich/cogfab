import { describe, expect, it } from "vitest";
import type { StateMessage } from "../net/types";
import { depositAt, hasPortAt, placementOccupancyAllows, placementTerrainAllows, RESOURCE_PALETTE } from "./resources";

const snap: StateMessage = {
  type: "state",
  width: 3,
  height: 1,
  tiles: Array.from({ length: 3 }, () => ({ kind: "empty" as const, dir: "north" as const })),
  deposits: [
    { x: 0, y: 0, kind: "copper", capacity: 100, remaining: 40 },
    { x: 1, y: 0, kind: "quartz", capacity: 100, remaining: 0 },
  ],
  ports: [{ x: 2, y: 0 }],
};

describe("resource terrain", () => {
  it("indexes deposits and defines every resource style", () => {
    expect(depositAt(snap, 0, 0)?.kind).toBe("copper");
    expect(Object.keys(RESOURCE_PALETTE)).toEqual([
      "iron",
      "copper",
      "quartz",
      "gold",
      "ironBar",
      "copperSheet",
      "quartzCrystal",
      "goldIngot",
    ]);
    expect(RESOURCE_PALETTE.gold.baseCredits).toBe(20);
    expect(RESOURCE_PALETTE.goldIngot.baseCredits).toBe(60);
    expect(hasPortAt(snap, 2, 0)).toBe(true);
  });

  it("allows extractors only on active deposits and sellers only on ports", () => {
    expect(placementTerrainAllows(snap, "extractor", 0, 0)).toBe(true);
    expect(placementTerrainAllows(snap, "extractor", 1, 0)).toBe(false);
    expect(placementTerrainAllows(snap, "extractor", 2, 0)).toBe(false);
    expect(placementTerrainAllows(snap, "seller", 2, 0)).toBe(true);
    expect(placementTerrainAllows(snap, "seller", 0, 0)).toBe(false);
  });

  it("allows refiners on open land like belts", () => {
    expect(placementTerrainAllows(snap, "refiner", 1, 0)).toBe(true);
    expect(placementTerrainAllows(snap, "refiner", 0, 0)).toBe(false);
    expect(placementTerrainAllows(snap, "refiner", 2, 0)).toBe(false);
  });

  it("keeps belts off ports and live deposits but allows depleted tiles", () => {
    expect(placementTerrainAllows(snap, "belt", 0, 0)).toBe(false);
    expect(placementTerrainAllows(snap, "belt", 1, 0)).toBe(true);
    expect(placementTerrainAllows(snap, "belt", 2, 0)).toBe(false);
  });

  it("allows only a refiner to replace an existing belt", () => {
    expect(placementOccupancyAllows("refiner", "belt")).toBe(true);
    expect(placementOccupancyAllows("seller", "belt")).toBe(false);
    expect(placementOccupancyAllows("refiner", "extractor")).toBe(false);
    expect(placementOccupancyAllows("belt", "empty")).toBe(true);
  });
});
