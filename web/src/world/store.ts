import type { ResourcesMessage, StateMessage } from "../net/types";
import { showPlacementFeedback } from "./placementFeedback";

// Full world snapshots and lightweight resource patches have separate stores.
// This keeps each useSyncExternalStore snapshot stable until its own subscribers
// are notified.
let current: StateMessage | null = null;
let terrain: StateMessage | null = null;
const listeners = new Set<() => void>();
const resourceListeners = new Set<() => void>();

// setLatest records a new snapshot and notifies subscribers.
export function setLatest(msg: StateMessage): void {
  const previous = current;
  current = msg;
  terrain = msg;
  showPlacementFeedback(previous, msg);
  for (const fn of listeners) fn();
  for (const fn of resourceListeners) fn();
}

// setResources replaces the sparse deposit list without making every factory
// mesh rebuild. Components that use resource state subscribe separately.
export function setResources(msg: ResourcesMessage): void {
  if (!terrain) return;
  terrain = { ...terrain, deposits: msg.deposits };
  for (const fn of resourceListeners) fn();
}

// resetLatest clears room-specific client state before the server sends a
// reconnect snapshot. Existing buildings should never replay placement feedback.
export function resetLatest(): void {
  current = null;
  terrain = null;
  for (const fn of listeners) fn();
  for (const fn of resourceListeners) fn();
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

// getTerrain includes the latest deposit totals. It changes only when
// subscribeResources listeners are notified.
export function getTerrain(): StateMessage | null {
  return terrain;
}

export function subscribeResources(fn: () => void): () => void {
  resourceListeners.add(fn);
  return () => {
    resourceListeners.delete(fn);
  };
}
