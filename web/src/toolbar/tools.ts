import type { Command, PlaceableKind } from "../net/types";

// A Tool is one toolbar entry: an id, a label, and the command it makes when you
// click a cell. "cell in -> command out."
export type Tool = {
  id: string;
  label: string;
  command: (x: number, y: number) => Command;
};

const place = (kind: PlaceableKind, x: number, y: number): Command => ({ type: "place", x, y, kind });

// THE LIST. Adding an item later is one line here. Nothing else changes.
export const TOOLS: Tool[] = [
  { id: "belt", label: "Belt", command: (x, y) => place("belt", x, y) },
  { id: "extractor", label: "Extractor", command: (x, y) => place("extractor", x, y) },
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
