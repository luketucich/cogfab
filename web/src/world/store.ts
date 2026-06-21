import type { StateMessage } from "../net/types";

// The latest authoritative snapshot from the server.
//
// This deliberately lives OUTSIDE React. The server streams several times a
// second; the 3D scene will read this every animation frame and update objects
// directly. If this were React state, the whole app would re-render on every
// tick. React only samples it occasionally, for the HUD.

let latest: StateMessage | null = null;

// setLatest stores a new snapshot.
export function setLatest(msg: StateMessage): void {
  latest = msg;
}

// getLatest returns the most recent snapshot, or null before the first one.
export function getLatest(): StateMessage | null {
  return latest;
}
