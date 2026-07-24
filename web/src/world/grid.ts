import type { Dir } from "../net/types";
import { STEP, SIDES } from "./dir";

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

// MACHINE_ROTATION orients the Factory Kit machine models. Their authored
// openings are a quarter-turn from the straight conveyor's default axis, so the
// same offset lines the extractor, refiner, and seller up with item travel.
export const MACHINE_ROTATION: Record<Dir, number> = {
  north: DIR_ANGLE.north + Math.PI / 2,
  east: DIR_ANGLE.east + Math.PI / 2,
  south: DIR_ANGLE.south + Math.PI / 2,
  west: DIR_ANGLE.west + Math.PI / 2,
};

// cornerAngle is the Y rotation pointing to the cell corner where `a` and `b`
// meet. The sum of their step vectors points at that corner (e.g. south + west
// -> (-1, +1), the SW corner), and atan2(x, z) measures the same way around +Y
// as DIR_ANGLE.
function cornerAngle(a: Dir, b: Dir): number {
  const x = STEP[a][0] + STEP[b][0];
  const z = STEP[a][1] + STEP[b][1];
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
  const missing = SIDES.find((d) => !edges.includes(d))!;
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

// CURSOR_TILE is the footprint of a player's empty-cell hover marker.
export const CURSOR_TILE = 0.96;

// inBounds reports whether (x, y) is on the grid.
function inBounds(snap: GridSize, x: number, y: number): boolean {
  return x >= 0 && x < snap.width && y >= 0 && y < snap.height;
}

// Rect is an inclusive cell rectangle.
export type Rect = { x0: number; y0: number; x1: number; y1: number };

// unlockedRect centres the gridW x gridH region players have bought so far in
// the world; the server rejects builds outside it. Mirror of unlockedRect in
// internal/server/shop.go; keep the centring in step.
export function unlockedRect(snap: GridSize, gridW: number, gridH: number): Rect {
  const x0 = Math.max(Math.floor((snap.width - gridW) / 2), 0);
  const y0 = Math.max(Math.floor((snap.height - gridH) / 2), 0);
  return {
    x0,
    y0,
    x1: Math.min(x0 + gridW, snap.width) - 1,
    y1: Math.min(y0 + gridH, snap.height) - 1,
  };
}

// isUnlocked reports whether players can build on (x, y).
export function isUnlocked(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1;
}

// cellIndex is the tiles index of (x, y), or -1 if off the grid.
export function cellIndex(snap: GridSize, x: number, y: number): number {
  return inBounds(snap, x, y) ? y * snap.width + x : -1;
}

// cellFromWorld maps a world (x, z) point back to a grid cell, or null if it is
// off the grid. Used for hover and placement.
export function cellFromWorld(worldX: number, worldZ: number, snap: GridSize): Cell | null {
  const { offX, offZ } = cellOffsets(snap);
  const x = Math.round(worldX + offX);
  const y = Math.round(worldZ + offZ);
  return inBounds(snap, x, y) ? { x, y } : null;
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
