import type { BuildPreview, Placement, StateMessage } from "../net/types";
import { cellIndex } from "./grid";

// visibleBuildPreview removes cells that already hold a placed building.
export function visibleBuildPreview(preview: BuildPreview, snap: StateMessage): BuildPreview | null {
  const placements = preview.placements.filter((placement) => {
    const index = cellIndex(snap, placement.x, placement.y);
    return index >= 0 && snap.tiles[index].kind === "empty";
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
