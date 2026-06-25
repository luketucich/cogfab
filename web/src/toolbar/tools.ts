import type { Command, Dir, PlaceableKind } from "../net/types";

// A Tool is one toolbar entry: an id, a label, and the command it makes for a
// cell facing a direction. "cell + direction in -> command out."
export type Tool = {
  id: string;
  label: string;
  command: (x: number, y: number, dir: Dir) => Command;
};

const place = (kind: PlaceableKind, x: number, y: number, dir: Dir): Command => ({ type: "place", x, y, kind, dir });

// THE LIST. Adding an item later is one line here. Nothing else changes.
export const TOOLS: Tool[] = [
  { id: "belt", label: "Belt", command: (x, y, dir) => place("belt", x, y, dir) },
  { id: "extractor", label: "Extractor", command: (x, y, dir) => place("extractor", x, y, dir) },
  { id: "destroy", label: "Destroy", command: (x, y) => ({ type: "destroy", x, y }) },
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

// Facing decides which way a single placement points and which way the hover
// arrow aims. The mouse-move direction and R both set it; Ground reads it each
// frame, so no notify is needed.
const ORDER: Dir[] = ["north", "east", "south", "west"];
let facing: Dir = "east";

export const getFacing = (): Dir => facing;

export function setFacing(dir: Dir): void {
  facing = dir;
}

export function rotateFacing(): void {
  facing = ORDER[(ORDER.indexOf(facing) + 1) % ORDER.length];
}
