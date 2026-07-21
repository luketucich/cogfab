import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import * as THREE from "three";
import { getLatest, subscribe } from "./store";
import { MACHINE_ROTATION, cellOffsets } from "./grid";
import { beltPiece } from "./beltShape";
import { useFactoryModels } from "./models";

const MAX_INSTANCES = 4096;

const dummy = new THREE.Object3D();

// placeInstance writes one positioned, rotated instance into a mesh.
function placeInstance(mesh: THREE.InstancedMesh, index: number, x: number, z: number, rotationY: number) {
  dummy.position.set(x, 0, z);
  dummy.rotation.set(0, rotationY, 0);
  dummy.updateMatrix();
  mesh.setMatrixAt(index, dummy.matrix);
}

// flush sets how many instances a mesh draws and uploads them to the GPU.
function flush(mesh: THREE.InstancedMesh, count: number) {
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
}

// Factory draws the placed structures as instanced models. Belts split into
// straight, corner, tee, and cross pieces, where the shape comes from each
// belt's neighbours. Extractors, sellers, and refiners draw as their own models.
// Nothing moves, so it rebuilds only when a new snapshot arrives.
export function Factory() {
  const { belt, corner, tee, cross, extractor, seller, refiner } = useFactoryModels();
  const straights = useRef<THREE.InstancedMesh>(null!);
  const corners = useRef<THREE.InstancedMesh>(null!);
  const tees = useRef<THREE.InstancedMesh>(null!);
  const crosses = useRef<THREE.InstancedMesh>(null!);
  const extractors = useRef<THREE.InstancedMesh>(null!);
  const sellers = useRef<THREE.InstancedMesh>(null!);
  const refiners = useRef<THREE.InstancedMesh>(null!);
  const snap = useSyncExternalStore(subscribe, getLatest);

  useLayoutEffect(() => {
    let nStraight = 0;
    let nCorner = 0;
    let nTee = 0;
    let nCross = 0;
    let nExt = 0;
    let nSeller = 0;
    let nRefiner = 0;
    if (snap) {
      const { width, height, tiles } = snap;
      const { offX, offZ } = cellOffsets(snap);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const tile = tiles[y * width + x];
          const wx = x - offX;
          const wz = y - offZ;
          if (tile.kind === "belt") {
            const { kind, rotationY } = beltPiece(snap, x, y, tile.dir);
            if (kind === "corner") placeInstance(corners.current, nCorner++, wx, wz, rotationY);
            else if (kind === "tee") placeInstance(tees.current, nTee++, wx, wz, rotationY);
            else if (kind === "cross") placeInstance(crosses.current, nCross++, wx, wz, rotationY);
            else placeInstance(straights.current, nStraight++, wx, wz, rotationY);
          } else if (tile.kind === "extractor") {
            placeInstance(extractors.current, nExt++, wx, wz, MACHINE_ROTATION[tile.dir]);
          } else if (tile.kind === "seller") {
            placeInstance(sellers.current, nSeller++, wx, wz, MACHINE_ROTATION[tile.dir]);
          } else if (tile.kind === "refiner") {
            placeInstance(refiners.current, nRefiner++, wx, wz, MACHINE_ROTATION[tile.dir]);
          }
        }
      }
    }
    flush(straights.current, nStraight);
    flush(corners.current, nCorner);
    flush(tees.current, nTee);
    flush(crosses.current, nCross);
    flush(extractors.current, nExt);
    flush(sellers.current, nSeller);
    flush(refiners.current, nRefiner);
  }, [snap]);

  return (
    <>
      <instancedMesh ref={straights} args={[belt.geometry, belt.material, MAX_INSTANCES]} frustumCulled={false} />
      <instancedMesh ref={corners} args={[corner.geometry, corner.material, MAX_INSTANCES]} frustumCulled={false} />
      <instancedMesh ref={tees} args={[tee.geometry, tee.material, MAX_INSTANCES]} frustumCulled={false} />
      <instancedMesh ref={crosses} args={[cross.geometry, cross.material, MAX_INSTANCES]} frustumCulled={false} />
      <instancedMesh ref={extractors} args={[extractor.geometry, extractor.material, MAX_INSTANCES]} frustumCulled={false} />
      <instancedMesh ref={sellers} args={[seller.geometry, seller.material, MAX_INSTANCES]} frustumCulled={false} />
      <instancedMesh ref={refiners} args={[refiner.geometry, refiner.material, MAX_INSTANCES]} frustumCulled={false} />
    </>
  );
}
