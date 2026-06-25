import type { StateMessage } from "../net/types";

// The latest snapshot from the server. Kept outside React so the socket can
// update it without owning a component; subscribe() lets components re-render
// when it changes.

let current: StateMessage | null = null;
const listeners = new Set<() => void>();

// setLatest records a new snapshot and notifies subscribers.
export function setLatest(msg: StateMessage): void {
  current = msg;
  for (const fn of listeners) fn();
}

// getLatest returns the most recent snapshot, or null before the first one.
export function getLatest(): StateMessage | null {
  return current;
}

// subscribe registers a listener called whenever the snapshot changes; the
// returned function unsubscribes. Pairs with getLatest for useSyncExternalStore.
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
