import type { Dir, StateMessage } from "../net/types";

const STEP: Record<Dir, [number, number]> = {
  north: [0, -1],
  east: [1, 0],
  south: [0, 1],
  west: [-1, 0],
};

const OPPOSITE: Record<Dir, Dir> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
};

const SIDES: Dir[] = ["north", "east", "south", "west"];

// FlowCell is a live belt and how a dot crosses it: the side material enters
// from and the side it leaves by (opposite sides run straight, perpendicular
// sides curve), plus whether its run reaches a seller (complete) or not (broken).
export type FlowCell = { entry: Dir; exit: Dir; complete: boolean };

// FlowResult maps a cell index (y * width + x) to its flow, for live belts only.
export type FlowResult = Map<number, FlowCell>;

// flow lights up the belts connected to an extractor and sends material outward
// along the belt path, whichever way it curves. A connected run that also
// touches a seller is complete; one that does not is broken. Belt facing does
// not gate flow, so the path you build is the path that flows.
export function flow(snap: StateMessage): FlowResult {
  const w = snap.width;
  const h = snap.height;
  const tiles = snap.tiles;
  const result: FlowResult = new Map();
  const seen = new Set<number>();

  const neighbour = (i: number, s: Dir): number => {
    const x = i % w;
    const y = (i - x) / w;
    const [dx, dy] = STEP[s];
    const nx = x + dx;
    const ny = y + dy;
    return nx < 0 || nx >= w || ny < 0 || ny >= h ? -1 : ny * w + nx;
  };

  // exitSide is where a dot leaves a belt: the first connected belt or seller
  // that is not where it entered, falling back to straight through.
  const exitSide = (i: number, entry: Dir): Dir => {
    for (const s of SIDES) {
      if (s === entry) continue;
      const n = neighbour(i, s);
      if (n >= 0 && (tiles[n].kind === "belt" || tiles[n].kind === "seller")) return s;
    }
    return OPPOSITE[entry];
  };

  // flood walks one connected run of belts from a starting belt, recording each
  // belt's entry side and whether the run touches a seller anywhere.
  const flood = (start: number, startEntry: Dir) => {
    const run: { i: number; entry: Dir }[] = [];
    const queue: { i: number; entry: Dir }[] = [{ i: start, entry: startEntry }];
    seen.add(start);
    let sells = false;
    while (queue.length) {
      const cell = queue.shift()!;
      run.push(cell);
      for (const s of SIDES) {
        if (s === cell.entry) continue;
        const n = neighbour(cell.i, s);
        if (n < 0) continue;
        const kind = tiles[n].kind;
        if (kind === "seller") sells = true;
        else if (kind === "belt" && !seen.has(n)) {
          seen.add(n);
          queue.push({ i: n, entry: OPPOSITE[s] });
        }
      }
    }
    for (const { i, entry } of run) result.set(i, { entry, exit: exitSide(i, entry), complete: sells });
  };

  // Seed from every belt an extractor sits next to, entering from the extractor.
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i].kind !== "extractor") continue;
    for (const s of SIDES) {
      const b = neighbour(i, s);
      if (b >= 0 && tiles[b].kind === "belt" && !seen.has(b)) flood(b, OPPOSITE[s]);
    }
  }

  return result;
}
