import type { Dir, StateMessage } from "../net/types";
import { BELT_ROTATION, cornerRotation, teeRotation } from "./grid";

// Step to the neighbour on each side, in grid coordinates.
const STEP: Record<Dir, [number, number]> = {
  north: [0, -1],
  east: [1, 0],
  south: [0, 1],
  west: [-1, 0],
};

const OPPOSITE: Record<Dir, Dir> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
};

const SIDES: Dir[] = ["north", "east", "south", "west"];

// isBelt is true when (x, y) is on the grid and holds a belt.
function isBelt(snap: StateMessage, x: number, y: number): boolean {
  if (x < 0 || x >= snap.width || y < 0 || y >= snap.height) return false;
  return snap.tiles[y * snap.width + x].kind === "belt";
}

// BeltShape is how a belt should be drawn, with enough info to orient the model:
// a straight piece facing dir, a corner joining two perpendicular edges, a tee
// with three arms, or a four-way cross.
export type BeltShape =
  | { kind: "straight"; dir: Dir }
  | { kind: "corner"; edges: [Dir, Dir] }
  | { kind: "tee"; edges: [Dir, Dir, Dir] }
  | { kind: "cross" };

// perpendicular is true when two sides meet at a cell corner (not the same edge
// and not opposite edges).
function perpendicular(a: Dir, b: Dir): boolean {
  return a !== b && a !== OPPOSITE[b];
}

// beltShape decides how the belt at (x, y) should be drawn from its neighbours
// alone: a side is connected when the next cell is also a belt, whichever way
// either one faces. The connected sides pick the piece, so dropping a belt
// between two others always joins them:
//   0 or 1 side, or 2 opposite sides -> straight
//   2 perpendicular sides            -> corner joining those edges
//   3 sides                          -> tee with those arms
//   4 sides                          -> cross
// A lone or end belt keeps its own facing; a straight run lies along its
// neighbours.
export function beltShape(snap: StateMessage, x: number, y: number, dir: Dir): BeltShape {
  const sides = SIDES.filter((side) => {
    const [dx, dy] = STEP[side];
    return isBelt(snap, x + dx, y + dy);
  });

  if (sides.length === 4) return { kind: "cross" };
  if (sides.length === 3) return { kind: "tee", edges: sides as [Dir, Dir, Dir] };
  if (sides.length === 2) {
    if (perpendicular(sides[0], sides[1])) return { kind: "corner", edges: sides as [Dir, Dir] };
    return { kind: "straight", dir: sides[0] }; // two opposite neighbours: lie along them
  }
  return { kind: "straight", dir };
}

// BeltPiece is the model a belt is drawn as plus its Y rotation. The factory
// uses it to route each belt to the right instanced mesh; the hover glow uses it
// to light up the matching shape. One source so the two never disagree.
export type BeltPiece = { kind: "straight" | "corner" | "tee" | "cross"; rotationY: number };

export function beltPiece(snap: StateMessage, x: number, y: number, dir: Dir): BeltPiece {
  const shape = beltShape(snap, x, y, dir);
  if (shape.kind === "corner") return { kind: "corner", rotationY: cornerRotation(shape.edges) };
  if (shape.kind === "tee") return { kind: "tee", rotationY: teeRotation(shape.edges) };
  if (shape.kind === "cross") return { kind: "cross", rotationY: 0 };
  return { kind: "straight", rotationY: BELT_ROTATION[shape.dir] };
}
