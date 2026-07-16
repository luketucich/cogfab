import { describe, it, expect } from "vitest";
import { beltShape } from "./beltShape";
import type { Dir, StateMessage, TileView } from "../net/types";

// snapshot builds a tiny factory from a map of "x,y" -> tile.
function snapshot(width: number, height: number, cells: Record<string, TileView>): StateMessage {
  const tiles: TileView[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      tiles.push(cells[`${x},${y}`] ?? { kind: "empty", dir: "north" });
    }
  }
  return { type: "state", width, height, tiles };
}

function grid(width: number, height: number, belts: Record<string, Dir>): StateMessage {
  const cells: Record<string, TileView> = {};
  for (const [cell, dir] of Object.entries(belts)) cells[cell] = { kind: "belt", dir };
  return snapshot(width, height, cells);
}

// The cell under test is the centre (1,1) of a 3x3 grid. Each side maps to its
// neighbour cell; a belt there connects that side whichever way it faces.
const NEIGHBOUR: Record<Dir, string> = {
  north: "1,0",
  south: "1,2",
  east: "2,1",
  west: "0,1",
};

// centre builds a 3x3 grid with a belt at the centre facing `dir` and a belt on
// each side in `sides` (its facing does not affect the shape).
function centre(dir: Dir, sides: Dir[]): StateMessage {
  const belts: Record<string, Dir> = { "1,1": dir };
  for (const side of sides) belts[NEIGHBOUR[side]] = "north";
  return grid(3, 3, belts);
}

const shapeAt = (snap: StateMessage, dir: Dir) => beltShape(snap, 1, 1, dir);

describe("beltShape", () => {
  it("is straight with no neighbours, keeping its facing", () => {
    expect(shapeAt(centre("east", []), "east")).toEqual({ kind: "straight", dir: "east" });
  });

  it("is straight with one neighbour, keeping its facing", () => {
    expect(shapeAt(centre("east", ["west"]), "east")).toEqual({ kind: "straight", dir: "east" });
  });

  it("lies along two opposite neighbours whatever it faces", () => {
    expect(shapeAt(centre("north", ["east", "west"]), "north")).toEqual({ kind: "straight", dir: "east" });
  });

  describe("corner: two perpendicular neighbours", () => {
    // Edges come back in N, E, S, W order; the centre's own facing is ignored.
    const cases: [Dir, Dir][] = [
      ["north", "east"],
      ["east", "south"],
      ["south", "west"],
      ["north", "west"],
    ];
    for (const edges of cases) {
      it(`joins {${edges.join(", ")}}`, () => {
        expect(shapeAt(centre("north", edges), "north")).toEqual({ kind: "corner", edges });
      });
    }
  });

  describe("tee: three neighbours", () => {
    const cases: { sides: [Dir, Dir, Dir]; missing: Dir }[] = [
      { sides: ["north", "east", "west"], missing: "south" },
      { sides: ["north", "east", "south"], missing: "west" },
      { sides: ["east", "south", "west"], missing: "north" },
      { sides: ["north", "south", "west"], missing: "east" },
    ];
    for (const { sides, missing } of cases) {
      it(`has arms {${sides.join(", ")}} (missing ${missing})`, () => {
        expect(shapeAt(centre("north", sides), "north")).toEqual({ kind: "tee", edges: sides });
      });
    }
  });

  it("is a cross with four neighbours", () => {
    expect(shapeAt(centre("north", ["north", "east", "south", "west"]), "north")).toEqual({ kind: "cross" });
  });

  it("curves through the sides used by the ore route", () => {
    const snap = snapshot(4, 3, {
      "1,0": { kind: "belt", dir: "north" }, // nearby, but not part of the route
      "1,1": { kind: "belt", dir: "north" },
      "2,1": { kind: "belt", dir: "east" },
      "3,1": { kind: "seller", dir: "west" },
      "1,2": { kind: "extractor", dir: "north" },
    });

    expect(beltShape(snap, 1, 1, "north")).toEqual({ kind: "corner", edges: ["east", "south"] });
    expect(beltShape(snap, 2, 1, "east")).toEqual({ kind: "straight", dir: "east" });
  });
});
