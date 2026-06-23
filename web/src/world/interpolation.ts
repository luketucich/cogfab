import type { StateMessage } from "../net/types";
import { DIRS, STEP } from "./grid";

function tileAt(snap: StateMessage, x: number, y: number) {
  if (x < 0 || x >= snap.width || y < 0 || y >= snap.height) return undefined;
  return snap.tiles[y * snap.width + x];
}

// sourceTile finds where the ore now at (bx, by) sat on the previous snapshot,
// so the renderer can glide it from there. If it was already here it stayed; if
// it just appeared (e.g. from an extractor) it has no source and does not glide.
export function sourceTile(prev: StateMessage, bx: number, by: number): [number, number] {
  const here = tileAt(prev, bx, by);
  if (here && here.item === "ore") return [bx, by];

  for (const d of DIRS) {
    const [dx, dy] = STEP[d];
    const upstream = tileAt(prev, bx - dx, by - dy);
    if (upstream && upstream.kind === "belt" && upstream.dir === d && upstream.item === "ore") {
      return [bx - dx, by - dy];
    }
  }
  return [bx, by];
}
