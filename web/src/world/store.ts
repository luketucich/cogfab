import type { StateMessage } from "../net/types";
import { showPlacementFeedback } from "./placementFeedback";

// The latest snapshot from the server. Kept outside React so the socket can
// update it without owning a component; subscribe() lets components re-render
// when it changes.

let current: StateMessage | null = null;
const listeners = new Set<() => void>();

// setLatest records a new snapshot and notifies subscribers.
export function setLatest(msg: StateMessage): void {
  const previous = current;
  current = msg;
  showPlacementFeedback(previous, msg);
  for (const fn of listeners) fn();
}

// resetLatest clears room-specific client state before the server sends a
// reconnect snapshot. Existing buildings should never replay placement feedback.
export function resetLatest(): void {
  current = null;
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
