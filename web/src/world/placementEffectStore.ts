import type { StateMessage, TileView } from "../net/types";

export type PlacementEffect = {
  id: number;
  x: number;
  y: number;
  kind: Exclude<TileView["kind"], "empty">;
  dir: TileView["dir"];
  startsAt: number;
  playSound: boolean;
};

type NewPlacement = Omit<PlacementEffect, "id" | "startsAt" | "playSound">;

let effects: PlacementEffect[] = [];
let nextID = 1;
const listeners = new Set<() => void>();

// newPlacements finds only accepted builds. Initial room loads, rotations,
// destroys, and existing tiles do not create placement effects.
export function newPlacements(previous: StateMessage | null, next: StateMessage): NewPlacement[] {
  if (!previous || previous.width !== next.width || previous.height !== next.height) return [];
  const added: NewPlacement[] = [];
  for (let i = 0; i < next.tiles.length; i++) {
    const tile = next.tiles[i];
    if (previous.tiles[i]?.kind !== "empty" || tile.kind === "empty") continue;
    added.push({
      x: i % next.width,
      y: Math.floor(i / next.width),
      kind: tile.kind,
      dir: tile.dir,
    });
  }
  return added;
}

export function addPlacementEffects(previous: StateMessage | null, next: StateMessage, now = performance.now()): void {
  const added = newPlacements(previous, next);
  if (added.length === 0) return;
  const spread = added.length === 1 ? 0 : 120 / (added.length - 1);
  effects = [
    ...effects,
    ...added.map((placement, i) => ({
      ...placement,
      id: nextID++,
      startsAt: now + i * spread,
      playSound: i === 0,
    })),
  ];
  for (const listener of listeners) listener();
}

export function finishPlacementEffect(id: number): void {
  const next = effects.filter((effect) => effect.id !== id);
  if (next.length === effects.length) return;
  effects = next;
  for (const listener of listeners) listener();
}

export function resetPlacementEffects(): void {
  if (effects.length === 0) return;
  effects = [];
  for (const listener of listeners) listener();
}

export function getPlacementEffects(): PlacementEffect[] {
  return effects;
}

export function subscribePlacementEffects(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
