import type { Cell } from "./grid";

// The grid cell the cursor is over, or null. Module state (not React) so Ground
// can publish it and HoverGlow can read it each frame, the same pattern as the
// facing in toolbar/tools.ts.
let hovered: Cell | null = null;

export const getHover = (): Cell | null => hovered;

export function setHover(cell: Cell | null): void {
  hovered = cell;
}
