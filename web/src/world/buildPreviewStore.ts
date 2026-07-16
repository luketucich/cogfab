import type { BuildPreview } from "../net/types";
import { connection } from "../net/connection";
import { subscribeSession } from "../net/session";

let current: BuildPreview | null = null;
const listeners = new Set<() => void>();

export function buildPreviewsEqual(a: BuildPreview | null, b: BuildPreview | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind || a.placements.length !== b.placements.length) return false;
  return a.placements.every((placement, i) => {
    const other = b.placements[i];
    return placement.x === other.x && placement.y === other.y && placement.dir === other.dir;
  });
}

function copy(preview: BuildPreview): BuildPreview {
  return { kind: preview.kind, placements: preview.placements.map((placement) => ({ ...placement })) };
}

function share(): void {
  connection.send(
    current
      ? { type: "preview", kind: current.kind, placements: current.placements }
      : { type: "preview", kind: "", placements: [] },
  );
}

// setBuildPreview updates the immediate local ghost and shares it with the
// room only when its logical cells or directions change.
export function setBuildPreview(preview: BuildPreview | null): void {
  if (buildPreviewsEqual(current, preview)) return;
  current = preview ? copy(preview) : null;
  for (const listener of listeners) listener();
  share();
}

export function getBuildPreview(): BuildPreview | null {
  return current;
}

export function subscribeBuildPreview(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// A fresh welcome creates a new server-side player, so restore any preview the
// local pointer is still holding through a reconnect.
subscribeSession(() => {
  if (current) share();
});
