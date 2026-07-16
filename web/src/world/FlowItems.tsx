import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { getTerrain, subscribeResources } from "./store";
import { beltMultiplier, emissionMultiplier, getStats, MATERIAL_GAP, MATERIAL_SPEED, MAX_SIM_LEVEL } from "./economy";
import { cellOffsets } from "./grid";
import { makeCurve, curvePoint, type Curve } from "./beltCurve";
import { flowPaths, runKey } from "./flow";
import { addBurst } from "./burst";
import { sfx } from "../sfx";
import type { ResourceKind } from "../net/types";
import { RESOURCE_PALETTE } from "./resources";

const MAX_ORE = 8192;
const ORE_Y = 0.5; // sit on the belt surface
const SIZE = 0.13; // chunk radius
const MAX_STEP = 0.1; // prevents material from teleporting after a backgrounded tab resumes

const RESOURCE_COLORS: Record<ResourceKind, THREE.Color> = {
  iron: new THREE.Color(RESOURCE_PALETTE.iron.color),
  copper: new THREE.Color(RESOURCE_PALETTE.copper.color),
  quartz: new THREE.Color(RESOURCE_PALETTE.quartz.color),
  gold: new THREE.Color(RESOURCE_PALETTE.gold.color),
};

// A Route is one extractor-to-seller path the material rides: the curve for each cell
// and the tile each cell sits on, so a chunk can tell when the belt under it is
// gone. nearest is per-frame scratch: the chunk closest to the extractor, noted
// while advancing so emission never rescans every chunk.
type Route = { curves: Curve[]; cells: number[]; resource: ResourceKind; active: boolean; nearest: number };

// A Chunk of material riding a route: how far it has travelled (in cells) and a
// fixed id so its tumble stays steady frame to frame.
type Chunk = { route: Route; dist: number; id: number };

// FlowItems draws raw material in the colour of its source deposit. A chunk drops the
// moment the belt beneath it disappears; chunks already past a break keep riding
// to the seller. Motion is client-side, so individual chunks never touch the wire.
export function FlowItems() {
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const chunks = useRef<Chunk[]>([]);
  const routes = useRef<Map<string, Route>>(new Map()); // live paths to emit onto
  const live = useRef<Set<Route>>(new Set()); // same routes, for O(1) is-it-alive checks
  const lastTime = useRef(0);
  const nextId = useRef(0);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const landing = useMemo(() => new THREE.Vector3(), []); // where a delivered chunk sparkles
  const geometry = useMemo(() => new THREE.IcosahedronGeometry(SIZE, 0), []);
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.75, metalness: 0.3, flatShading: true }),
    [],
  );
  const snap = useSyncExternalStore(subscribeResources, getTerrain);

  // Track the live extractor-to-seller paths. A path that persists keeps its Route
  // object, so the chunks already riding it carry on uninterrupted; a path that is
  // gone just stops being emitted onto, and its chunks drain off on their own.
  useLayoutEffect(() => {
    const next = new Map<string, Route>();
    if (snap) {
      const { offX, offZ } = cellOffsets(snap);
      for (const run of flowPaths(snap)) {
        if (!run.complete) continue; // material only rides paths that reach a seller
        const key = runKey(run);
        const previous = routes.current.get(key);
        if (previous) previous.active = run.active;
        next.set(
          key,
          previous ?? {
            curves: run.steps.map((s) => makeCurve(s.x - offX, s.y - offZ, s.entry, s.exit)),
            cells: run.steps.map((s) => s.y * snap.width + s.x),
            resource: run.resource,
            active: run.active,
            nearest: Infinity,
          },
        );
      }
    }
    routes.current = next;
    live.current = new Set(next.values());
  }, [snap]);

  useFrame(({ clock }) => {
    const now = clock.elapsedTime;
    // Belt Speed levels carry material visibly faster, up to the sim cap;
    // mirror of beltSpeed in economy.go.
    const step =
      Math.min(now - lastTime.current, MAX_STEP) *
      MATERIAL_SPEED *
      beltMultiplier(Math.min(getStats().beltLevel, MAX_SIM_LEVEL));
    lastTime.current = now;

    // Advance every chunk, dropping the ones that reached the seller or whose belt
    // is gone (a gap, or all belts cleared), noting each route's nearest chunk
    // in passing.
    for (const route of routes.current.values()) route.nearest = Infinity;
    const alive: Chunk[] = [];
    for (const chunk of chunks.current) {
      chunk.dist += step;
      const cell = Math.floor(chunk.dist);
      if (cell >= chunk.route.cells.length) {
        // Consumed. A live route ends at a seller, so sparkle where the material
        // vanished; material on a cut route just rides off with no fanfare.
        if (live.current.has(chunk.route)) {
          curvePoint(chunk.route.curves[chunk.route.curves.length - 1], 1, 0, landing);
          addBurst({ x: landing.x, z: landing.z, color: "#ffd57a", count: 2 });
          sfx.deliver();
        }
        continue;
      }
      if (snap?.tiles[chunk.route.cells[cell]]?.kind !== "belt") continue; // belt gone: fell off
      if (chunk.dist < chunk.route.nearest) chunk.route.nearest = chunk.dist;
      alive.push(chunk);
    }

    // Emit a fresh chunk at the head of each live path once the nearest one has
    // moved a gap ahead, starting it at the overshoot so no spacing is lost.
    // Each Extractor Rate level up to the sim cap packs them tighter; mirror of
    // emitGap and emit in economy.go.
    const gap = MATERIAL_GAP / emissionMultiplier(Math.min(getStats().extractorLevel, MAX_SIM_LEVEL));
    for (const route of routes.current.values()) {
      if (!route.active) continue;
      if (route.nearest === Infinity) alive.push({ route, dist: 0, id: nextId.current++ });
      else if (route.nearest >= gap) alive.push({ route, dist: route.nearest - gap, id: nextId.current++ });
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
      mesh.current.setColorAt(inst - 1, RESOURCE_COLORS[chunk.route.resource]);
    }
    mesh.current.count = inst;
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  });

  return <instancedMesh ref={mesh} args={[geometry, material, MAX_ORE]} frustumCulled={false} />;
}
