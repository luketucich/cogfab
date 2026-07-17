import type { ResourcesMessage, StateMessage, TilesMessage, TileUpdate } from "../net/types";
import { showPlacementFeedback } from "./placementFeedback";

// Factory topology and resource stock have separate snapshots. This keeps each
// useSyncExternalStore value stable until its own subscribers are notified.
let current: StateMessage | null = null;
let terrain: StateMessage | null = null;
const listeners = new Set<() => void>();
const resourceListeners = new Set<() => void>();

// setLatest records a new snapshot and notifies subscribers.
export function setLatest(msg: StateMessage): void {
  current = msg;
  terrain = msg;
  for (const fn of listeners) fn();
  for (const fn of resourceListeners) fn();
}

function validBatch(msg: TilesMessage, snap: StateMessage): boolean {
  return msg.tiles.length > 0 && msg.tiles.every((entry) => {
    return entry.x >= 0 && entry.x < snap.width && entry.y >= 0 && entry.y < snap.height;
  });
}

// applyTiles applies one authoritative placement, destroy, or rotation batch.
// The shared tile array changes once, while each snapshot keeps its own resource
// totals so stock updates remain independent of factory topology.
export function applyTiles(msg: TilesMessage): void {
  if (!current || !terrain) return;
  if (!validBatch(msg, current)) return;

  let tiles: StateMessage["tiles"] | null = null;
  const changed: TileUpdate[] = [];
  for (const entry of msg.tiles) {
    const index = entry.y * current.width + entry.x;
    const previous = (tiles ?? current.tiles)[index];
    if (previous.kind === entry.kind && previous.dir === entry.dir) continue;
    if (!tiles) tiles = current.tiles.slice();
    tiles[index] = { kind: entry.kind, dir: entry.dir };
    changed.push(entry);
  }
  if (!tiles) return;

  const previous = current;
  current = { ...current, tiles };
  terrain = terrain === previous ? current : { ...terrain, tiles };
  showPlacementFeedback(previous, changed);
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
