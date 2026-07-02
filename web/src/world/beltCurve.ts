import type { Vector3 } from "three";
import type { Dir } from "../net/types";
import { STEP } from "./dir";

// A Curve is how something crosses one belt cell: the cell's centre in world
// space and the step vectors toward the sides it enters and leaves by. A point
// traces a quadratic Bezier from the entry edge, through the centre, to the exit
// edge, so it runs straight across opposite sides and curves through
// perpendicular ones. Shared by the flow arrows and the ore so they move along
// belts identically.
export type Curve = {
  centreX: number;
  centreZ: number;
  entryX: number; // step toward the side ore enters from
  entryZ: number;
  exitX: number; // step toward the side ore leaves by
  exitZ: number;
};

// makeCurve builds the curve for a cell centred at world (centreX, centreZ),
// entered from `entry` and left by `exit`.
export function makeCurve(centreX: number, centreZ: number, entry: Dir, exit: Dir): Curve {
  const [entryX, entryZ] = STEP[entry];
  const [exitX, exitZ] = STEP[exit];
  return { centreX, centreZ, entryX, entryZ, exitX, exitZ };
}

// curvePoint writes the world position at fraction t (0..1) along the curve into
// `out`, at height y. The three Bezier control points are the entry edge, the
// cell centre, and the exit edge (each edge is half a cell out from the centre).
// No allocation, so it is cheap to call per chunk per frame.
export function curvePoint(curve: Curve, t: number, y: number, out: Vector3): void {
  const entryEdgeX = curve.centreX + curve.entryX * 0.5;
  const entryEdgeZ = curve.centreZ + curve.entryZ * 0.5;
  const exitEdgeX = curve.centreX + curve.exitX * 0.5;
  const exitEdgeZ = curve.centreZ + curve.exitZ * 0.5;
  const entryWeight = (1 - t) * (1 - t);
  const centreWeight = 2 * (1 - t) * t;
  const exitWeight = t * t;
  out.set(
    entryWeight * entryEdgeX + centreWeight * curve.centreX + exitWeight * exitEdgeX,
    y,
    entryWeight * entryEdgeZ + centreWeight * curve.centreZ + exitWeight * exitEdgeZ,
  );
}

// curveHeading is the Y rotation facing the way the curve travels at fraction t,
// blending the entry and exit directions so a marker turns through a corner.
export function curveHeading(curve: Curve, t: number): number {
  const dirX = (1 - t) * -curve.entryX + t * curve.exitX;
  const dirZ = (1 - t) * -curve.entryZ + t * curve.exitZ;
  return Math.atan2(-dirZ, dirX);
}
