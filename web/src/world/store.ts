import type { StateMessage } from "../net/types";

// The two most recent snapshots from the server, plus when each arrived. The 3D
// scene interpolates between them so motion is smooth instead of jumping once
// per server tick. Kept outside React so the stream never triggers a re-render.

let current: StateMessage | null = null;
let previous: StateMessage | null = null;
let currentTime = 0;
let previousTime = 0;

// setLatest records a new snapshot. The optional `now` is for tests; in the app
// it defaults to the current time.
export function setLatest(msg: StateMessage, now: number = performance.now()): void {
  previous = current;
  previousTime = currentTime;
  current = msg;
  currentTime = now;
}

// getLatest returns the most recent snapshot, or null before the first one.
export function getLatest(): StateMessage | null {
  return current;
}

type Frame = {
  current: StateMessage;
  previous: StateMessage | null;
  alpha: number;
};

// getFrame returns the two latest snapshots and how far (0..1) we are between
// them at time `now`, for interpolation. Returns null before the first snapshot.
export function getFrame(now: number): Frame | null {
  if (!current) return null;
  const span = currentTime - previousTime;
  const alpha = span > 0 ? Math.min(1, Math.max(0, (now - currentTime) / span)) : 1;
  return { current, previous, alpha };
}
