import type { StateMessage } from "../net/types";

// The latest snapshot from the server.
//
// This lives outside React on purpose. The server streams several times a
// second and the 3D scene will read it every frame. If it were React state the
// whole app would re-render on every tick; instead React only samples it for
// the HUD.

let latest: StateMessage | null = null;

// setLatest stores a new snapshot.
export function setLatest(msg: StateMessage): void {
  latest = msg;
}

// getLatest returns the most recent snapshot, or null before the first one.
export function getLatest(): StateMessage | null {
  return latest;
}
