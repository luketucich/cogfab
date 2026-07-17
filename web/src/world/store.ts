import type { DepositView, ResourcesMessage, StateMessage, TilesMessage, TileUpdate, TileView } from "../net/types";
import { showPlacementFeedback } from "./placementFeedback";

type PredictedTile = {
  x: number;
  y: number;
  before: TileView;
  after: TileView;
};

type PredictedAction = {
  id: number;
  tiles: PredictedTile[];
};

// Confirmed state comes from the server. The visible state replays local
// actions over it so input feels immediate without weakening server authority.
let confirmed: StateMessage | null = null;
let visible: StateMessage | null = null;
let terrain: StateMessage | null = null;
let pending: PredictedAction[] = [];
const listeners = new Set<() => void>();
const resourceListeners = new Set<() => void>();

const sameTile = (a: TileView, b: TileView): boolean => a.kind === b.kind && a.dir === b.dir;

function sameDeposits(a: DepositView[], b: DepositView[]): boolean {
  return a.length === b.length && a.every((deposit, index) => {
    const other = b[index];
    return deposit.x === other.x && deposit.y === other.y && deposit.kind === other.kind &&
      deposit.capacity === other.capacity && deposit.remaining === other.remaining;
  });
}

function sameState(a: StateMessage | null, b: StateMessage | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.width !== b.width || a.height !== b.height || a.tiles.length !== b.tiles.length) return false;
  if (!a.tiles.every((tile, index) => sameTile(tile, b.tiles[index]))) return false;
  if (!sameDeposits(a.deposits, b.deposits) || a.ports.length !== b.ports.length) return false;
  return a.ports.every((port, index) => port.x === b.ports[index].x && port.y === b.ports[index].y);
}

function stableState(previous: StateMessage | null, next: StateMessage | null): StateMessage | null {
  return sameState(previous, next) ? previous : next;
}

function validUpdates(updates: TileUpdate[], snap: StateMessage): boolean {
  if (updates.length === 0) return false;
  const seen = new Set<number>();
  for (const update of updates) {
    if (update.x < 0 || update.x >= snap.width || update.y < 0 || update.y >= snap.height) return false;
    const index = update.y * snap.width + update.x;
    if (seen.has(index)) return false;
    seen.add(index);
  }
  return true;
}

// projectPending preserves atomic batches. An action is shown only when every
// tile still matches the state it was built against.
function projectPending(): StateMessage | null {
  if (!confirmed) return null;
  let tiles = confirmed.tiles;
  for (const action of pending) {
    const valid = action.tiles.every((change) => {
      const index = change.y * confirmed!.width + change.x;
      return index >= 0 && index < tiles.length && sameTile(tiles[index], change.before);
    });
    if (!valid) continue;
    if (tiles === confirmed.tiles) tiles = confirmed.tiles.slice();
    for (const change of action.tiles) {
      tiles[change.y * confirmed.width + change.x] = change.after;
    }
  }
  return tiles === confirmed.tiles ? confirmed : { ...confirmed, tiles };
}

function terrainFor(nextVisible: StateMessage | null, resourceSource: StateMessage | null): StateMessage | null {
  if (!nextVisible || !resourceSource) return nextVisible;
  if (nextVisible.deposits === resourceSource.deposits && nextVisible.ports === resourceSource.ports) return nextVisible;
  return { ...nextVisible, deposits: resourceSource.deposits, ports: resourceSource.ports };
}

function publishProjection(resourceSource = terrain): boolean {
  const previousVisible = visible;
  const previousTerrain = terrain;
  visible = stableState(previousVisible, projectPending());
  terrain = stableState(previousTerrain, terrainFor(visible, resourceSource ?? visible));

  const visibleChanged = visible !== previousVisible;
  const terrainChanged = terrain !== previousTerrain;
  if (visibleChanged) {
    for (const fn of listeners) fn();
  }
  if (terrainChanged) {
    for (const fn of resourceListeners) fn();
  }
  return visibleChanged;
}

function visibleUpdates(previous: StateMessage, next: StateMessage, updates: TileUpdate[]): TileUpdate[] {
  return updates.filter((update) => {
    const index = update.y * next.width + update.x;
    return index >= 0 && index < previous.tiles.length && !sameTile(previous.tiles[index], next.tiles[index]);
  }).map((update) => {
    const tile = next.tiles[update.y * next.width + update.x];
    return { ...update, kind: tile.kind, dir: tile.dir };
  });
}

// setLatest replaces the authoritative snapshot, then rebases local actions.
export function setLatest(msg: StateMessage): void {
  confirmed = msg;
  publishProjection(msg);
}

// predictAction adds one atomic local action to the visible projection.
export function predictAction(actionId: number, updates: TileUpdate[]): boolean {
  if (!visible || !Number.isSafeInteger(actionId) || actionId <= 0 || pending.some((action) => action.id === actionId)) {
    return false;
  }
  if (!validUpdates(updates, visible)) return false;

  const tiles = updates.map((update): PredictedTile => {
    const before = visible!.tiles[update.y * visible!.width + update.x];
    return {
      x: update.x,
      y: update.y,
      before: { ...before },
      after: { kind: update.kind, dir: update.dir },
    };
  });
  if (tiles.every((tile) => sameTile(tile.before, tile.after))) return false;

  pending = [...pending, { id: actionId, tiles }];
  publishProjection();
  return true;
}

// resolveAction removes exactly one confirmed or rejected local action.
export function resolveAction(actionId: number): boolean {
  const index = pending.findIndex((action) => action.id === actionId);
  if (index < 0) return false;
  pending = [...pending.slice(0, index), ...pending.slice(index + 1)];
  publishProjection();
  return true;
}

// clearPredictions returns the view to the latest authoritative state.
export function clearPredictions(): void {
  if (pending.length === 0) return;
  pending = [];
  publishProjection();
}

// applyTiles applies one authoritative placement, destroy, or rotation batch,
// then rebases local actions over the result.
export function applyTiles(msg: TilesMessage): void {
  if (!confirmed || !validUpdates(msg.tiles, confirmed)) return;

  let tiles: StateMessage["tiles"] | null = null;
  for (const entry of msg.tiles) {
    const index = entry.y * confirmed.width + entry.x;
    const previous = (tiles ?? confirmed.tiles)[index];
    if (sameTile(previous, entry)) continue;
    if (!tiles) tiles = confirmed.tiles.slice();
    tiles[index] = { kind: entry.kind, dir: entry.dir };
  }
  if (!tiles) return;

  const previousVisible = visible;
  confirmed = { ...confirmed, tiles };
  publishProjection();
  if (previousVisible && visible && previousVisible !== visible) {
    showPlacementFeedback(previousVisible, visibleUpdates(previousVisible, visible, msg.tiles));
  }
}

// setResources replaces sparse deposit totals without rebuilding topology.
export function setResources(msg: ResourcesMessage): void {
  if (!terrain || sameDeposits(terrain.deposits, msg.deposits)) return;
  terrain = { ...terrain, deposits: msg.deposits };
  for (const fn of resourceListeners) fn();
}

// resetLatest clears room state and any actions tied to the old connection.
export function resetLatest(): void {
  const hadVisible = visible !== null;
  const hadTerrain = terrain !== null;
  confirmed = null;
  visible = null;
  terrain = null;
  pending = [];
  if (hadVisible) {
    for (const fn of listeners) fn();
  }
  if (hadTerrain) {
    for (const fn of resourceListeners) fn();
  }
}

export function getLatest(): StateMessage | null {
  return visible;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getTerrain(): StateMessage | null {
  return terrain;
}

export function subscribeResources(fn: () => void): () => void {
  resourceListeners.add(fn);
  return () => {
    resourceListeners.delete(fn);
  };
}
