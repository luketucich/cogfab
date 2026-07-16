import type { Dir, StateMessage } from "../net/types";
import { OPPOSITE, SIDES, STEP } from "./dir";
import { flowConnections } from "./flow";
import { BELT_ROTATION, cellIndex, cornerRotation, teeRotation } from "./grid";

// isBelt is true when (x, y) is on the grid and holds a belt.
function isBelt(snap: StateMessage, x: number, y: number): boolean {
  const i = cellIndex(snap, x, y);
  return i >= 0 && snap.tiles[i].kind === "belt";
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

// beltShape prefers the sides used by the live material route, including connections
// to extractors and sellers. Belts outside a route still join their belt
// neighbours, which keeps incomplete construction readable. The chosen sides
// pick the piece:
//   0 or 1 side, or 2 opposite sides -> straight
//   2 perpendicular sides            -> corner joining those edges
//   3 sides                          -> tee with those arms
//   4 sides                          -> cross
export function beltShape(snap: StateMessage, x: number, y: number, dir: Dir): BeltShape {
  const index = cellIndex(snap, x, y);
  const routed = flowConnections(snap).get(index);
  const sides = routed
    ? [...routed]
    : SIDES.filter((side) => {
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
