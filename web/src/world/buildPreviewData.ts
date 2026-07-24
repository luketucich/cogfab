import type { BuildPreview, PlaceableKind, Placement, StateMessage } from "../net/types";
import { beltShape } from "./beltShape";
import { cellIndex } from "./grid";
import { placementOccupancyAllows, placementTerrainAllows } from "./resources";

// placementOccupancyAllowsAt adds the one geometric restriction on replacing a
// belt: a straight refiner cannot preserve a corner or junction.
export function placementOccupancyAllowsAt(
  snap: StateMessage,
  kind: PlaceableKind,
  x: number,
  y: number,
): boolean {
  const index = cellIndex(snap, x, y);
  if (index < 0 || !placementOccupancyAllows(kind, snap.tiles[index].kind)) return false;
  if (kind !== "refiner" || snap.tiles[index].kind !== "belt") return true;
  return beltShape(snap, x, y, snap.tiles[index].dir).kind === "straight";
}

// resolvePlacementDirections preserves the actual routed alignment of a belt
// being upgraded to a refiner. Belt facing is only a fallback visual hint, so
// reading the routed shape avoids turning a horizontal line vertical. New
// refiners still follow the player's click or drag axis.
export function resolvePlacementDirections(
  kind: PlaceableKind,
  placements: Placement[],
  snap: StateMessage,
): Placement[] {
  if (kind !== "refiner") return placements;
  let changed = false;
  const resolved = placements.map((placement) => {
    const index = cellIndex(snap, placement.x, placement.y);
    const tile = index >= 0 ? snap.tiles[index] : undefined;
    if (tile?.kind !== "belt") return placement;
    const shape = beltShape(snap, placement.x, placement.y, tile.dir);
    if (shape.kind !== "straight" || shape.dir === placement.dir) return placement;
    changed = true;
    return { ...placement, dir: shape.dir };
  });
  return changed ? resolved : placements;
}

// visibleBuildPreview removes cells that cannot accept this building. Refiners
// remain visible over belts because that replacement is a valid placement.
export function visibleBuildPreview(preview: BuildPreview, snap: StateMessage): BuildPreview | null {
  const placements = preview.placements.filter((placement) => {
    const index = cellIndex(snap, placement.x, placement.y);
    return (
      index >= 0 &&
      placementOccupancyAllowsAt(snap, preview.kind, placement.x, placement.y) &&
      placementTerrainAllows(snap, preview.kind, placement.x, placement.y)
    );
  });
  return placements.length > 0 ? { kind: preview.kind, placements } : null;
}

// previewSnapshot overlays an uncommitted belt path for accurate corner and
// junction models without changing the real server snapshot.
export function previewSnapshot(preview: BuildPreview, snap: StateMessage): StateMessage {
  if (preview.kind !== "belt") return snap;
  const tiles = snap.tiles.slice();
  for (const placement of preview.placements) {
    const index = cellIndex(snap, placement.x, placement.y);
    if (index >= 0 && tiles[index].kind === "empty") {
      tiles[index] = { kind: "belt", dir: placement.dir };
    }
  }
  return { ...snap, tiles };
}

// continuousPlacementPaths keeps adjacent preview cells in one drawable path.
// A hidden occupied cell starts a new path instead of drawing through it.
export function continuousPlacementPaths(placements: Placement[]): Placement[][] {
  const paths: Placement[][] = [];
  for (const placement of placements) {
    const current = paths[paths.length - 1];
    const previous = current?.[current.length - 1];
    if (!previous || Math.abs(previous.x - placement.x) + Math.abs(previous.y - placement.y) !== 1) {
      paths.push([placement]);
    } else {
      current.push(placement);
    }
  }
  return paths;
}
