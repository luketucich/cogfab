import type { Dir } from "../net/types";

type GridSize = { width: number; height: number };

// Cell is a grid coordinate.
export type Cell = { x: number; y: number };

// DIR_ANGLE is the Y rotation (radians, around the up axis) that turns an edge
// pointing the model's default way (south, where the straight conveyor flows)
// onto the named direction. Axis convention: east=+x, west=-x, south=+z,
// north=-z. Rotating a south edge by these lands it exactly on its direction,
// so this is also the heading angle of each edge.
const DIR_ANGLE: Record<Dir, number> = {
  south: 0,
  west: -Math.PI / 2,
  north: Math.PI,
  east: Math.PI / 2,
};

// Belt direction to the rotation that faces the straight conveyor the way it
// moves items. The model flows south by default, so this is just DIR_ANGLE.
export const BELT_ROTATION: Record<Dir, number> = DIR_ANGLE;

// Sum of two edge unit vectors points to the cell corner where they meet, e.g.
// south+west -> (-1, +1) is the SW corner. Used to orient corner pieces.
const EDGE_VEC: Record<Dir, [number, number]> = {
  north: [0, -1],
  south: [0, 1],
  east: [1, 0],
  west: [-1, 0],
};

// cornerAngle is the Y rotation pointing to the cell corner where `a` and `b`
// meet. atan2(x, z) measures the same way around +Y as DIR_ANGLE.
function cornerAngle(a: Dir, b: Dir): number {
  const x = EDGE_VEC[a][0] + EDGE_VEC[b][0];
  const z = EDGE_VEC[a][1] + EDGE_VEC[b][1];
  return Math.atan2(x, z);
}

// The corner model joins {south, west} by default, so its corner vector points
// SW. Rotating that onto the target corner gives four distinct rotations and no
// mirror (a corner is symmetric across its own diagonal).
const CORNER_DEFAULT_ANGLE = cornerAngle("south", "west");

// cornerRotation is the Y rotation for a corner joining its two perpendicular
// edges. Derived: rotate the model's default SW corner onto the target corner.
export function cornerRotation(edges: [Dir, Dir]): number {
  return cornerAngle(edges[0], edges[1]) - CORNER_DEFAULT_ANGLE;
}

// The tee model connects {north, east, west} by default, so its missing arm is
// south. Its orientation is fixed entirely by which edge is missing.
const TEE_DEFAULT_MISSING: Dir = "south";

// teeRotation is the Y rotation for a tee with the given three arms. Derived:
// the only absent direction is the missing arm, so rotate the model's default
// missing edge (south) onto the target missing edge.
export function teeRotation(edges: [Dir, Dir, Dir]): number {
  const missing = (["north", "east", "south", "west"] as Dir[]).find((d) => !edges.includes(d))!;
  return DIR_ANGLE[missing] - DIR_ANGLE[TEE_DEFAULT_MISSING];
}

// cellOffsets centre each tile on a grid cell, for any grid size, so a 1-unit
// model fills exactly one cell. World position of tile (x, y) is then
// (x - offX, y - offZ).
export function cellOffsets(snap: GridSize): { offX: number; offZ: number } {
  return {
    offX: Math.floor(snap.width / 2) - 0.5,
    offZ: Math.floor(snap.height / 2) - 0.5,
  };
}

// cellFromWorld maps a world (x, z) point back to a grid cell, or null if it is
// off the grid. Used for hover and placement.
export function cellFromWorld(worldX: number, worldZ: number, snap: GridSize): Cell | null {
  const { offX, offZ } = cellOffsets(snap);
  const x = Math.round(worldX + offX);
  const y = Math.round(worldZ + offZ);
  if (x < 0 || x >= snap.width || y < 0 || y >= snap.height) return null;
  return { x, y };
}

// dirBetween returns the facing from cell a toward the adjacent cell b.
export function dirBetween(a: Cell, b: Cell): Dir {
  if (b.y < a.y) return "north";
  if (b.y > a.y) return "south";
  if (b.x > a.x) return "east";
  return "west";
}

// dirFromDelta returns the cardinal direction of the larger movement (dx along
// x/east, dz along z/south), e.g. for cursor motion. Ties go to east/west.
export function dirFromDelta(dx: number, dz: number): Dir {
  if (Math.abs(dx) >= Math.abs(dz)) return dx > 0 ? "east" : "west";
  return dz > 0 ? "south" : "north";
}

// cellsBetween returns the cells on a straight Manhattan path from a to b (x
// first, then y), excluding a and including b. A fast drag can jump several
// cells at once, so this fills the line so the belt has no gaps.
export function cellsBetween(a: Cell, b: Cell): Cell[] {
  const cells: Cell[] = [];
  let { x, y } = a;
  const sx = Math.sign(b.x - x);
  while (x !== b.x) {
    x += sx;
    cells.push({ x, y });
  }
  const sy = Math.sign(b.y - y);
  while (y !== b.y) {
    y += sy;
    cells.push({ x, y });
  }
  return cells;
}
