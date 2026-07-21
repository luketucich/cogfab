import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { getTerrain, subscribeResources } from "./store";
import {
  beltMultiplier,
  emissionMultiplier,
  getStats,
  MATERIAL_GAP,
  MATERIAL_SPEED,
  MAX_SIM_LEVEL,
  refineTime,
} from "./economy";
import { cellOffsets } from "./grid";
import { makeCurve, curvePoint, type Curve } from "./beltCurve";
import { flowPaths, runKey } from "./flow";
import { addBurst } from "./burst";
import { sfx } from "../sfx";
import type { ResourceKind } from "../net/types";
import { isRawResource, refineResource, RESOURCE_PALETTE } from "./resources";

const MAX_ORE = 8192;
const ORE_Y = 0.5; // sit on the belt surface
const SIZE = 0.13; // chunk radius
const MAX_STEP = 0.1; // prevents material from teleporting after a backgrounded tab resumes

const RESOURCE_COLORS: Record<ResourceKind, THREE.Color> = {
  iron: new THREE.Color(RESOURCE_PALETTE.iron.color),
  copper: new THREE.Color(RESOURCE_PALETTE.copper.color),
  quartz: new THREE.Color(RESOURCE_PALETTE.quartz.color),
  gold: new THREE.Color(RESOURCE_PALETTE.gold.color),
  ironBar: new THREE.Color(RESOURCE_PALETTE.ironBar.color),
  copperSheet: new THREE.Color(RESOURCE_PALETTE.copperSheet.color),
  quartzCrystal: new THREE.Color(RESOURCE_PALETTE.quartzCrystal.color),
  goldIngot: new THREE.Color(RESOURCE_PALETTE.goldIngot.color),
};

// A Route is one extractor-to-seller path the material rides: the curve for each cell
// and the tile each cell sits on, so a chunk can tell when the belt under it is
// gone. nearest is per-frame scratch: the chunk closest to the extractor, noted
// while advancing so emission never rescans every chunk.
type Route = { curves: Curve[]; cells: number[]; resource: ResourceKind; active: boolean; nearest: number };

// A Chunk of material riding a route: how far it has travelled (in cells) and a
// fixed id so its tumble stays steady frame to frame. Resource upgrades when a
// refiner finishes; processLeft is the remaining refine time in seconds.
type Chunk = {
  route: Route;
  dist: number;
  id: number;
  resource: ResourceKind;
  processLeft: number;
};

// FlowItems draws material in flight. Chunks pause inside refiners, change colour
// when refined, and drop if the path cell beneath them disappears. Motion is
// client-side, so individual chunks never touch the wire.
export function FlowItems() {
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const chunks = useRef<Chunk[]>([]);
  const routes = useRef<Map<string, Route>>(new Map()); // live paths to emit onto
  const live = useRef<Set<Route>>(new Set()); // same routes, for O(1) is-it-alive checks
  const busy = useRef<Map<number, Chunk>>(new Map()); // refiner cell → processing chunk
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
  // Stock-only updates keep this reference stable, avoiding route rebuilds.
  const flow = snap ? flowPaths(snap) : null;

  // Track the live extractor-to-seller paths. A path that persists keeps its Route
  // object, so the chunks already riding it carry on uninterrupted; a path that is
  // gone just stops being emitted onto, and its chunks drain off on their own.
  useLayoutEffect(() => {
    const next = new Map<string, Route>();
    if (snap) {
      const { offX, offZ } = cellOffsets(snap);
      for (const run of flow ?? []) {
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
  }, [flow, snap?.width, snap?.height]);

  useFrame(({ clock }) => {
    const now = clock.elapsedTime;
    const dt = Math.min(now - lastTime.current, MAX_STEP);
    // Belt Speed levels carry material visibly faster, up to the sim cap;
    // mirror of beltSpeed in economy.go.
    const step = dt * MATERIAL_SPEED * beltMultiplier(Math.min(getStats().beltLevel, MAX_SIM_LEVEL));
    const processSeconds = refineTime(getStats().refinerLevel);
    lastTime.current = now;

    // Advance every chunk, pausing on refiners while they work, dropping the ones
    // that reached the seller or whose path cell is gone, noting each route's
    // nearest chunk in passing.
    for (const route of routes.current.values()) route.nearest = Infinity;
    const alive: Chunk[] = [];
    for (const chunk of chunks.current) {
      const cell = Math.floor(chunk.dist);
      const tileKind = snap?.tiles[chunk.route.cells[cell]]?.kind;
      if (cell < chunk.route.cells.length && tileKind === "refiner" && isRawResource(chunk.resource)) {
        const refiner = chunk.route.cells[cell];
        const owner = busy.current.get(refiner);
        if (owner && owner !== chunk) {
          chunk.dist = cell;
        } else {
          if (chunk.processLeft <= 0) {
            busy.current.set(refiner, chunk);
            chunk.processLeft = processSeconds;
          }
          chunk.processLeft -= dt;
          if (chunk.processLeft > 0) {
            chunk.dist = cell;
          } else {
            chunk.processLeft = 0;
            chunk.resource = refineResource(chunk.resource);
            busy.current.delete(refiner);
            chunk.dist += step;
          }
        }
      } else {
        chunk.dist += step;
      }

      const nextCell = Math.floor(chunk.dist);
      if (nextCell >= chunk.route.cells.length) {
        for (const [cellIndex, owner] of busy.current) {
          if (owner === chunk) busy.current.delete(cellIndex);
        }
        if (live.current.has(chunk.route)) {
          curvePoint(chunk.route.curves[chunk.route.curves.length - 1], 1, 0, landing);
          addBurst({ x: landing.x, z: landing.z, color: "#ffd57a", count: 2 });
          sfx.deliver();
        }
        continue;
      }
      const kind = snap?.tiles[chunk.route.cells[nextCell]]?.kind;
      if (kind !== "belt" && kind !== "refiner") {
        for (const [cellIndex, owner] of busy.current) {
          if (owner === chunk) busy.current.delete(cellIndex);
        }
        continue;
      }
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
      if (route.nearest === Infinity) {
        alive.push({ route, dist: 0, id: nextId.current++, resource: route.resource, processLeft: 0 });
      } else if (route.nearest >= gap) {
        alive.push({
          route,
          dist: route.nearest - gap,
          id: nextId.current++,
          resource: route.resource,
          processLeft: 0,
        });
      }
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
      mesh.current.setColorAt(inst - 1, RESOURCE_COLORS[chunk.resource]);
    }
    mesh.current.count = inst;
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  });

  return <instancedMesh ref={mesh} args={[geometry, material, MAX_ORE]} frustumCulled={false} />;
}
