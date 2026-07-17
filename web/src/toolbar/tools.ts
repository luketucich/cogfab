import type { Dir } from "../net/types";
import { clockwise } from "../world/dir";

// A Tool is one toolbar entry: its id, label, number key, and build cost.
export type Tool = {
  id: string;
  label: string;
  hotkey: string;
  cost?: number;
};

// The tools. Costs mirror buildCost in internal/server/shop.go; keep them in
// step. Add a tool here and give it an icon in Toolbar.tsx.
export const TOOLS: Tool[] = [
  { id: "belt", label: "Belt", hotkey: "1", cost: 10 },
  { id: "extractor", label: "Extractor", hotkey: "2", cost: 75 },
  { id: "seller", label: "Seller", hotkey: "3", cost: 75 },
  { id: "destroy", label: "Destroy", hotkey: "4" },
];

// Which tool is selected. Module state (not React) so the DOM toolbar and the
// in-canvas Ground can share it. Same pattern as world/store.ts.
let selectedId = "belt";
const listeners = new Set<() => void>();

export const getSelectedId = (): string => selectedId;
export const getSelectedTool = (): Tool => TOOLS.find((t) => t.id === selectedId) ?? TOOLS[0];

export function selectTool(id: string): void {
  selectedId = id;
  for (const fn of listeners) fn();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// Facing decides which way a placement and its preview point. Mouse movement
// and R both set it; Ground reads it directly, so no notify is needed.
let facing: Dir = "east";

export const getFacing = (): Dir => facing;

export function setFacing(dir: Dir): void {
  facing = dir;
}

// rotateFacing steps to the next direction clockwise (R cycles through SIDES).
export function rotateFacing(): void {
  facing = clockwise(facing);
}
