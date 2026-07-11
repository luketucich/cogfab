import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { getLatest, subscribe } from "./store";
import { beltMultiplier, getStats, MAX_SIM_LEVEL } from "./economy";
import { cellOffsets } from "./grid";
import { chevronGeometry } from "./chevron";
import { makeCurve, curvePoint, curveHeading, type Curve } from "./beltCurve";
import { flowPaths, runKey, drainRuns } from "./flow";

const MAX_CHEVRONS = 8192;
const CHEVRON_Y = 0.46; // ride just above the belt surface
const SPEED = 0.6; // visual cells per second
const OPACITY = 0.3; // subtle directional cue
const FADE = 0.4; // seconds a deleted run's arrows take to shrink away
const COMPLETE = new THREE.Color("#ffffff"); // a run that reaches a seller
const BROKEN = new THREE.Color("#ff6b6b"); // a run that dead-ends before one

// A run of belt curves the chevrons drift along, coloured by whether it reaches a
// seller. death is when its belts went away, so it fades out instead of vanishing;
// null while the run still exists.
type Run = { key: string; segs: Curve[]; color: THREE.Color; death: number | null };

// FlowArrows paints the path the ore takes: a faint chevron drifts along every
// belt of every run, white when the run reaches a seller and red when it
// dead-ends. Built from the same runs as the ore, so an arrow flows out of each
// extractor and the two always agree. When a run's belts are deleted it fades out
// rather than snapping off. Purely cosmetic, all client-side.
export function FlowArrows() {
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const runs = useRef<Run[]>([]);
  const clockNow = useRef(0); // latest clock time, to stamp deaths
  const phase = useRef(0); // accumulated drift, so a speed change never jumps
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const geometry = useMemo(() => chevronGeometry(), []);
  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ transparent: true, opacity: OPACITY, side: THREE.DoubleSide, toneMapped: false }),
    [],
  );
  const snap = useSyncExternalStore(subscribe, getLatest);

  // Reconcile runs with the world, then colour each chevron. A run whose belts
  // were deleted is kept on briefly so it can fade out instead of snapping off.
  useLayoutEffect(() => {
    const now = clockNow.current;
    const live: Run[] = [];
    if (snap) {
      const { offX, offZ } = cellOffsets(snap);
      for (const run of flowPaths(snap)) {
        const segs = run.steps.map((s) => makeCurve(s.x - offX, s.y - offZ, s.entry, s.exit));
        live.push({ key: runKey(run), segs, color: run.complete ? COMPLETE : BROKEN, death: null });
      }
    }
    runs.current = drainRuns(runs.current, live, now, FADE);

    let inst = 0;
    for (const run of runs.current) {
      for (let c = 0; c < run.segs.length; c++) {
        if (inst >= MAX_CHEVRONS) break;
        mesh.current.setColorAt(inst++, run.color);
      }
    }
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  }, [snap]);

  // Drift the chevrons along their curves and face them the way they travel, off a
  // shared clock. A deleted run keeps drifting while it shrinks to nothing.
  useFrame(({ clock }, delta) => {
    const now = clock.elapsedTime;
    clockNow.current = now;
    // One shared offset so every chevron drifts together, hurrying up a little
    // with each Belt Speed level up to the sim cap.
    phase.current = (phase.current + delta * SPEED * beltMultiplier(Math.min(getStats().beltLevel, MAX_SIM_LEVEL))) % 1;
    const t = phase.current;
    let inst = 0;
    for (const { segs, death } of runs.current) {
      const fade = death === null ? 1 : Math.max(0, 1 - (now - death) / FADE);
      for (const seg of segs) {
        if (inst >= MAX_CHEVRONS) break;
        curvePoint(seg, t, CHEVRON_Y, dummy.position);
        dummy.rotation.set(0, curveHeading(seg, t), 0);
        dummy.scale.setScalar(fade); // shrink away as a deleted run drains off
        dummy.updateMatrix();
        mesh.current.setMatrixAt(inst++, dummy.matrix);
      }
    }
    // Set count every frame, not just on world change, so a stale count left by a
    // hot reload can never strand a leftover chevron.
    mesh.current.count = inst;
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={mesh} args={[geometry, material, MAX_CHEVRONS]} frustumCulled={false} />;
}
