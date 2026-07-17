import type { BuildPreview } from "../net/types";
import { connection } from "../net/connection";
import { subscribeSession } from "../net/session";

let current: BuildPreview | null = null;
const listeners = new Set<() => void>();
const SEND_EVERY = 50; // 20 updates per second matches the shared cursor cadence
let lastSentAt = -Infinity;
let pending: ReturnType<typeof setTimeout> | null = null;

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

function shareNow(): void {
  if (pending) {
    clearTimeout(pending);
    pending = null;
  }
  lastSentAt = performance.now();
  connection.send(
    current
      ? { type: "preview", kind: current.kind, placements: current.placements }
      : { type: "preview", kind: "", placements: [] },
  );
}

// Keep the local ghost immediate while the network receives at most one latest
// preview per 50ms window.
function share(): void {
  const wait = SEND_EVERY - (performance.now() - lastSentAt);
  if (wait <= 0) {
    shareNow();
  } else if (!pending) {
    pending = setTimeout(() => {
      pending = null;
      shareNow();
    }, wait);
  }
}

// setBuildPreview updates the immediate local ghost and shares it with the
// room only when its logical cells or directions change.
export function setBuildPreview(preview: BuildPreview | null): void {
  if (buildPreviewsEqual(current, preview)) return;
  current = preview ? copy(preview) : null;
  for (const listener of listeners) listener();
  if (current) share();
  else shareNow(); // clearing a stale remote ghost should never wait
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
  if (current) shareNow();
});
