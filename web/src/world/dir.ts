import type { Dir } from "../net/types";

// Direction helpers shared across the grid, belt shaping, and flow. One home so
// the four directions are never spelled out again.

// STEP is the grid step to the neighbour on each side: x runs east, y runs south.
export const STEP: Record<Dir, [number, number]> = {
  north: [0, -1],
  east: [1, 0],
  south: [0, 1],
  west: [-1, 0],
};

export const OPPOSITE: Record<Dir, Dir> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
};

// SIDES lists the four directions, for walking a cell's neighbours.
export const SIDES: Dir[] = ["north", "east", "south", "west"];

export function clockwise(dir: Dir): Dir {
  return SIDES[(SIDES.indexOf(dir) + 1) % SIDES.length];
}
