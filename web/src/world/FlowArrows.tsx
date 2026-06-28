import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Dir } from "../net/types";
import { getLatest, subscribe } from "./store";
import { cellOffsets } from "./grid";
import { chevronGeometry } from "./chevron";
import { flow } from "./flow";

const MAX_CHEVRONS = 8192;
const PER_CELL = 1; // one chevron per belt: sparse and clean
const CHEVRON_Y = 0.46; // ride just above the belt surface
const SPEED = 0.6; // cells per second
const OPACITY = 0.3; // faint, a whisper of direction rather than cargo
const COMPLETE = new THREE.Color("#ffffff"); // a run that reaches a seller
const BROKEN = new THREE.Color("#ff6b6b"); // a run that dead-ends before one

const STEP: Record<Dir, [number, number]> = {
  north: [0, -1],
  east: [1, 0],
  south: [0, 1],
  west: [-1, 0],
};

// One curve per live belt: the cell centre plus the entry/exit step vectors the
// chevron travels between, from the entry edge through the centre to the exit edge.
type Curve = { cx: number; cz: number; enx: number; enz: number; exx: number; exz: number };

// FlowArrows shows where material is heading: a faint stream of chevrons per live
// belt, sliding along the belt's curve and facing the way it flows. Complete runs
// glow; broken runs (fed by an extractor but reaching no seller) run red. All
// client-side, from the layout.
export function FlowArrows() {
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const curves = useRef<Curve[]>([]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const geometry = useMemo(() => chevronGeometry(), []);
  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ transparent: true, opacity: OPACITY, side: THREE.DoubleSide, toneMapped: false }),
    [],
  );
  const snap = useSyncExternalStore(subscribe, getLatest);

  // Recompute the live belts only when the world changes, colouring each cell's
  // chevrons by whether its run is complete.
  useLayoutEffect(() => {
    const next: Curve[] = [];
    let inst = 0;
    if (snap) {
      const { offX, offZ } = cellOffsets(snap);
      for (const [index, cell] of flow(snap)) {
        const cx = (index % snap.width) - offX;
        const cz = Math.floor(index / snap.width) - offZ;
        const [enx, enz] = STEP[cell.entry];
        const [exx, exz] = STEP[cell.exit];
        next.push({ cx, cz, enx, enz, exx, exz });
        const color = cell.complete ? COMPLETE : BROKEN;
        for (let k = 0; k < PER_CELL; k++) mesh.current.setColorAt(inst++, color);
      }
    }
    curves.current = next;
    mesh.current.count = next.length * PER_CELL;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  }, [snap]);

  // Slide the chevrons along each curve, staggered into a stream, off a shared clock.
  useFrame(({ clock }) => {
    const base = clock.elapsedTime * SPEED;
    const list = curves.current;
    let inst = 0;
    for (let c = 0; c < list.length; c++) {
      const a = list[c];
      const p0x = a.cx + a.enx * 0.5;
      const p0z = a.cz + a.enz * 0.5;
      const p2x = a.cx + a.exx * 0.5;
      const p2z = a.cz + a.exz * 0.5;
      for (let k = 0; k < PER_CELL; k++) {
        const t = (base + k / PER_CELL) % 1; // staggered phase per chevron
        const u = 1 - t;
        const we = u * u;
        const wc = 2 * u * t;
        const wx = t * t;
        const px = we * p0x + wc * a.cx + wx * p2x;
        const pz = we * p0z + wc * a.cz + wx * p2z;
        const tx = u * -a.enx + t * a.exx;
        const tz = u * -a.enz + t * a.exz;
        dummy.position.set(px, CHEVRON_Y, pz);
        dummy.rotation.set(0, Math.atan2(-tz, tx), 0);
        dummy.updateMatrix();
        mesh.current.setMatrixAt(inst++, dummy.matrix);
      }
    }
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={mesh} args={[geometry, material, MAX_CHEVRONS]} frustumCulled={false} />;
}
