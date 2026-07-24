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
  visualBatchSize,
} from "./economy";
import { cellOffsets } from "./grid";
import { makeCurve, curveHeading, curvePoint, type Curve } from "./beltCurve";
import { flowPaths, runKey } from "./flow";
import { OPPOSITE, STEP } from "./dir";
import { addBurst } from "./burst";
import { sfx } from "../sfx";
import type { ResourceKind } from "../net/types";
import { isRawResource, refineResource, RESOURCE_PALETTE } from "./resources";
import { makeIngotGeometry, makeOreGeometry } from "./materialGeometry";
import { spacedBehind } from "./materialMotion";

const MAX_ORE = 8192;
const BELT_SURFACE_Y = 0.405;
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
// fixed id for subtle visual variation. Resource upgrades when a refiner
// finishes; processLeft is the remaining refine time in seconds.
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
  const rawMesh = useRef<THREE.InstancedMesh>(null!);
  const refinedMesh = useRef<THREE.InstancedMesh>(null!);
  const chunks = useRef<Chunk[]>([]);
  const routes = useRef<Map<string, Route>>(new Map()); // live paths to emit onto
  const live = useRef<Set<Route>>(new Set()); // same routes, for O(1) is-it-alive checks
  const busy = useRef<Map<number, Chunk>>(new Map()); // refiner cell → processing chunk
  const frontByRoute = useRef<Map<Route, number>>(new Map()); // queue spacing scratch
  const lastTime = useRef(0);
  const nextId = useRef(0);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const landing = useMemo(() => new THREE.Vector3(), []); // where a delivered chunk sparkles
  const rawGeometry = useMemo(() => makeOreGeometry(SIZE), []);
  const refinedGeometry = useMemo(makeIngotGeometry, []);
  const rawMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.75, metalness: 0.3, flatShading: true }),
    [],
  );
  const refinedMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.28, metalness: 0.42, flatShading: true }),
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
        const sourceX = run.source % snap.width;
        const sourceY = Math.floor(run.source / snap.width);
        const sourceDir = snap.tiles[run.source].dir;
        const last = run.steps[run.steps.length - 1];
        const [sellerDX, sellerDY] = STEP[last.exit];
        const sellerX = last.x + sellerDX;
        const sellerY = last.y + sellerDY;
        next.set(
          key,
          previous ?? {
            curves: [
              makeCurve(sourceX - offX, sourceY - offZ, OPPOSITE[sourceDir], sourceDir),
              ...run.steps.map((s) => makeCurve(s.x - offX, s.y - offZ, s.entry, s.exit)),
              makeCurve(sellerX - offX, sellerY - offZ, OPPOSITE[last.exit], last.exit),
            ],
            cells: [
              run.source,
              ...run.steps.map((s) => s.y * snap.width + s.x),
              sellerY * snap.width + sellerX,
            ],
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
    const stats = getStats();
    // Belt Speed levels carry material visibly faster, up to the sim cap;
    // mirror of beltSpeed in economy.go.
    const step = dt * MATERIAL_SPEED * beltMultiplier(Math.min(stats.beltLevel, MAX_SIM_LEVEL));
    const processSeconds =
      refineTime(stats.refinerLevel) * visualBatchSize(stats.extractorLevel, stats.beltLevel);
    const gap = MATERIAL_GAP / emissionMultiplier(Math.min(stats.extractorLevel, MAX_SIM_LEVEL));
    lastTime.current = now;

    // Advance every chunk, pausing on refiners while they work, dropping the ones
    // that reached the seller or whose path cell is gone, noting each route's
    // nearest chunk in passing.
    for (const route of routes.current.values()) route.nearest = Infinity;
    const alive: Chunk[] = [];
    const refinerBudget = new Map<number, number>();
    frontByRoute.current.clear();
    for (const chunk of chunks.current) {
      const cell = Math.floor(chunk.dist);
      const tileKind = snap?.tiles[chunk.route.cells[cell]]?.kind;
      if (cell < chunk.route.cells.length && tileKind === "refiner" && isRawResource(chunk.resource)) {
        const refiner = chunk.route.cells[cell];
        const owner = busy.current.get(refiner);
        if (owner && owner !== chunk) {
          chunk.dist = cell + 0.08;
        } else {
          if (chunk.processLeft <= 0) {
            busy.current.set(refiner, chunk);
            chunk.processLeft = processSeconds;
          }
          const budget = refinerBudget.get(refiner) ?? dt;
          const used = Math.min(chunk.processLeft, budget);
          chunk.processLeft -= used;
          refinerBudget.set(refiner, budget - used);
          if (chunk.processLeft > 1e-12) {
            chunk.dist = cell + 0.5;
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

      // Oldest chunks are visited first. Keep every following piece one visual
      // gap behind it so a stopped refiner forms a readable conveyor queue
      // instead of stacking many meshes at the same point.
      const front = frontByRoute.current.get(chunk.route);
      const spacedDistance = spacedBehind(front, chunk.dist, gap);
      if (spacedDistance === null) {
        for (const [cellIndex, owner] of busy.current) {
          if (owner === chunk) busy.current.delete(cellIndex);
        }
        continue;
      }
      chunk.dist = spacedDistance;
      frontByRoute.current.set(chunk.route, chunk.dist);

      const nextCell = Math.floor(chunk.dist);
      if (nextCell >= chunk.route.cells.length) {
        for (const [cellIndex, owner] of busy.current) {
          if (owner === chunk) busy.current.delete(cellIndex);
        }
        if (live.current.has(chunk.route)) {
          curvePoint(chunk.route.curves[chunk.route.curves.length - 1], 0.65, 0, landing);
          addBurst({ x: landing.x, z: landing.z, color: "#ffd57a", count: 2 });
          sfx.deliver();
        }
        continue;
      }
      const kind = snap?.tiles[chunk.route.cells[nextCell]]?.kind;
      const supported =
        (nextCell === 0 && kind === "extractor") ||
        (nextCell === chunk.route.cells.length - 1 && kind === "seller") ||
        kind === "belt" ||
        kind === "refiner";
      if (!supported) {
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
    // emitGap and emit in economy.go. The browser never retains more cosmetic
    // chunks than it can draw, even on a pathological full-world layout.
    for (const route of routes.current.values()) {
      if (alive.length >= MAX_ORE) break;
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

    let rawCount = 0;
    let refinedCount = 0;
    for (const chunk of alive) {
      if (rawCount + refinedCount >= MAX_ORE) break;
      const cell = Math.floor(chunk.dist);
      const curve = chunk.route.curves[cell];
      const fraction = chunk.dist - cell;
      curvePoint(curve, fraction, BELT_SURFACE_Y, dummy.position);
      const raw = isRawResource(chunk.resource);
      if (raw) {
        // The nugget has a flat base and a fixed pose, so it reads as weight
        // carried by the belt rather than a rock rolling or floating above it.
        dummy.rotation.set(0, 0, 0);
      } else {
        // Refined bars ride flat and point along the belt's tangent, turning
        // smoothly through corners instead of appearing sideways.
        dummy.rotation.set(0, curveHeading(curve, fraction), 0);
      }
      dummy.updateMatrix();
      const target = raw ? rawMesh.current : refinedMesh.current;
      const index = raw ? rawCount++ : refinedCount++;
      target.setMatrixAt(index, dummy.matrix);
      target.setColorAt(index, RESOURCE_COLORS[chunk.resource]);
    }
    rawMesh.current.count = rawCount;
    rawMesh.current.instanceMatrix.needsUpdate = true;
    if (rawMesh.current.instanceColor) rawMesh.current.instanceColor.needsUpdate = true;
    refinedMesh.current.count = refinedCount;
    refinedMesh.current.instanceMatrix.needsUpdate = true;
    if (refinedMesh.current.instanceColor) refinedMesh.current.instanceColor.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh ref={rawMesh} args={[rawGeometry, rawMaterial, MAX_ORE]} frustumCulled={false} />
      <instancedMesh ref={refinedMesh} args={[refinedGeometry, refinedMaterial, MAX_ORE]} frustumCulled={false} />
    </>
  );
}
