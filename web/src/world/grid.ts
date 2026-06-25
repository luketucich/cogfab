import type { TileView } from "../net/types";

type GridSize = { width: number; height: number };

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
export function cellFromWorld(
  worldX: number,
  worldZ: number,
  snap: GridSize,
): { x: number; y: number } | null {
  const { offX, offZ } = cellOffsets(snap);
  const x = Math.round(worldX + offX);
  const y = Math.round(worldZ + offZ);
  if (x < 0 || x >= snap.width || y < 0 || y >= snap.height) return null;
  return { x, y };
}
