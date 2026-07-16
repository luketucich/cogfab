import type { PlaceableKind, StateMessage } from "../net/types";
import { sfx } from "../sfx";
import { addBurst } from "./burst";
import { cellOffsets } from "./grid";

type NewPlacement = {
  x: number;
  y: number;
  kind: PlaceableKind;
};

const BURST_PROFILE: Record<PlaceableKind, { radius: number; y: number; count: number }> = {
  belt: { radius: 0.38, y: 0.18, count: 7 },
  extractor: { radius: 0.62, y: 0.28, count: 12 },
  seller: { radius: 0.62, y: 0.28, count: 12 },
};

// newPlacements finds accepted builds without replaying feedback for room loads,
// rotations, destroyed tiles, or buildings that were already present.
export function newPlacements(previous: StateMessage | null, next: StateMessage): NewPlacement[] {
  if (!previous || previous.width !== next.width || previous.height !== next.height) return [];
  const added: NewPlacement[] = [];
  for (let i = 0; i < next.tiles.length; i++) {
    const tile = next.tiles[i];
    if (previous.tiles[i]?.kind !== "empty" || tile.kind === "empty") continue;
    added.push({ x: i % next.width, y: Math.floor(i / next.width), kind: tile.kind });
  }
  return added;
}

// showPlacementFeedback adds a small burst after the authoritative snapshot
// makes each new building visible. A batch shares one placement sound.
export function showPlacementFeedback(previous: StateMessage | null, next: StateMessage): void {
  const added = newPlacements(previous, next);
  if (added.length === 0) return;
  const { offX, offZ } = cellOffsets(next);
  for (const placement of added) {
    const profile = BURST_PROFILE[placement.kind];
    addBurst({
      x: placement.x - offX,
      y: profile.y,
      z: placement.y - offZ,
      radius: profile.radius,
      color: "#b8c8df",
      count: profile.count,
    });
  }
  sfx.place();
}
