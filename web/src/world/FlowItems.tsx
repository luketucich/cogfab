import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { getLatest, subscribe } from "./store";
import { beltMultiplier, getStats, MAX_SIM_LEVEL, ORE_GAP, ORE_SPEED } from "./economy";
import { cellOffsets } from "./grid";
import { makeCurve, curvePoint, type Curve } from "./beltCurve";
import { flowPaths, runKey } from "./flow";
import { addBurst } from "./burst";

const MAX_ORE = 8192;
const ORE_Y = 0.5; // sit on the belt surface
const SIZE = 0.13; // chunk radius
const ORE = new THREE.Color("#8a7f72"); // iron ore: a warm grey rock
const MAX_STEP = 0.1; // clamp the frame step so a backgrounded tab does not teleport ore

// A Route is one extractor-to-seller path the ore rides: the curve for each cell
// and the tile each cell sits on, so a chunk can tell when the belt under it is
// gone.
type Route = { curves: Curve[]; cells: number[] };

// A Chunk of ore riding a route: how far along it has travelled (in cells) and a
// fixed id so its tumble stays steady frame to frame.
type Chunk = { route: Route; dist: number; id: number };

// FlowItems is the material on the belts: grey iron-ore chunks the extractor emits
// one at a time, each riding the belts to the seller on its own. A chunk is
// dropped the moment the belt under it is gone, so it falls off at a gap instead
// of skipping it, while a chunk already past a break rides the remaining belts on
// to the seller. All client-side, from the layout, so nothing per-item touches the
// wire.
export function FlowItems() {
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const chunks = useRef<Chunk[]>([]);
  const routes = useRef<Map<string, Route>>(new Map()); // live paths to emit onto
  const lastTime = useRef(0);
  const nextId = useRef(0);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const landing = useMemo(() => new THREE.Vector3(), []); // where a delivered chunk sparkles
  const geometry = useMemo(() => new THREE.IcosahedronGeometry(SIZE, 0), []);
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ color: ORE, roughness: 0.75, metalness: 0.3, flatShading: true }),
    [],
  );
  const snap = useSyncExternalStore(subscribe, getLatest);

  // Track the live extractor-to-seller paths. A path that persists keeps its Route
  // object, so the chunks already riding it carry on uninterrupted; a path that is
  // gone just stops being emitted onto, and its chunks drain off on their own.
  useLayoutEffect(() => {
    const next = new Map<string, Route>();
    if (snap) {
      const { offX, offZ } = cellOffsets(snap);
      for (const run of flowPaths(snap)) {
        if (!run.complete) continue; // ore only rides paths that reach a seller
        const key = runKey(run);
        next.set(
          key,
          routes.current.get(key) ?? {
            curves: run.steps.map((s) => makeCurve(s.x - offX, s.y - offZ, s.entry, s.exit)),
            cells: run.steps.map((s) => s.y * snap.width + s.x),
          },
        );
      }
    }
    routes.current = next;
  }, [snap]);

  useFrame(({ clock }) => {
    const now = clock.elapsedTime;
    // Belt Speed levels carry the ore visibly faster, up to the sim cap;
    // mirror of beltSpeed in economy.go.
    const step =
      Math.min(now - lastTime.current, MAX_STEP) * ORE_SPEED * beltMultiplier(Math.min(getStats().beltLevel, MAX_SIM_LEVEL));
    lastTime.current = now;

    // Advance every chunk, dropping the ones that reached the seller or whose belt
    // is gone (a gap, or all belts cleared).
    const alive: Chunk[] = [];
    for (const chunk of chunks.current) {
      chunk.dist += step;
      const cell = Math.floor(chunk.dist);
      if (cell >= chunk.route.cells.length) {
        // Consumed. A live route ends at a seller, so sparkle where the ore
        // vanished; ore on a cut route just rides off with no fanfare.
        for (const route of routes.current.values()) {
          if (route === chunk.route) {
            curvePoint(route.curves[route.curves.length - 1], 1, 0, landing);
            addBurst({ x: landing.x, z: landing.z, color: "#ffd57a", count: 2 });
            break;
          }
        }
        continue;
      }
      if (snap?.tiles[chunk.route.cells[cell]]?.kind !== "belt") continue; // belt gone: fell off
      alive.push(chunk);
    }

    // Emit a fresh chunk at the head of each live path once the nearest one has
    // moved a gap ahead, starting it at the overshoot so no spacing is lost.
    // Each Extractor Rate level up to the sim cap packs them tighter; mirror of
    // emitGap and emit in economy.go.
    const gap = ORE_GAP / (1 + 0.5 * Math.min(getStats().extractorLevel, MAX_SIM_LEVEL));
    for (const route of routes.current.values()) {
      let nearest = Infinity;
      for (const chunk of alive) if (chunk.route === route && chunk.dist < nearest) nearest = chunk.dist;
      if (nearest === Infinity) alive.push({ route, dist: 0, id: nextId.current++ });
      else if (nearest >= gap) alive.push({ route, dist: nearest - gap, id: nextId.current++ });
    }
    chunks.current = alive;

    let inst = 0;
    for (const chunk of alive) {
      if (inst >= MAX_ORE) break;
      const cell = Math.floor(chunk.dist);
      curvePoint(chunk.route.curves[cell], chunk.dist - cell, ORE_Y, dummy.position);
      dummy.rotation.set(chunk.id * 1.7, chunk.id * 0.9, chunk.id * 2.3); // fixed tumble, no spin
      dummy.updateMatrix();
      mesh.current.setMatrixAt(inst++, dummy.matrix);
    }
    mesh.current.count = inst;
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={mesh} args={[geometry, material, MAX_ORE]} frustumCulled={false} />;
}
