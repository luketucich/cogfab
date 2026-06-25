import type { Dir, TileView } from "../net/types";

type GridSize = { width: number; height: number };

// Cell is a grid coordinate.
export type Cell = { x: number; y: number };

// Belt direction to a rotation (radians, around the up axis) that faces the
// conveyor model the way it moves items. Tuned to the model's default heading.
export const BELT_ROTATION: Record<TileView["dir"], number> = {
  north: Math.PI,
  east: Math.PI / 2,
  south: 0,
  west: -Math.PI / 2,
};

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
