import type { PlaceableKind, StateMessage, TileUpdate } from "../net/types";
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
  refiner: { radius: 0.62, y: 0.28, count: 12 },
};

// newPlacements inspects only the cells in one accepted server batch. Rotations,
// destroys, and already-occupied cells do not replay placement feedback.
export function newPlacements(previous: StateMessage, entries: TileUpdate[]): NewPlacement[] {
  return entries.flatMap((entry) => {
    const before = previous.tiles[entry.y * previous.width + entry.x];
    return before?.kind === "empty" && entry.kind !== "empty" ? [{ x: entry.x, y: entry.y, kind: entry.kind }] : [];
  });
}

// showPlacementFeedback adds a small burst after the server accepts each new
// building. A batch shares one placement sound.
export function showPlacementFeedback(previous: StateMessage, entries: TileUpdate[]): void {
  const added = newPlacements(previous, entries);
  if (added.length === 0) return;
  const { offX, offZ } = cellOffsets(previous);
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
