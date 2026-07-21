import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import * as THREE from "three";
import { getLatest, subscribe } from "./store";
import { MACHINE_ROTATION, cellOffsets } from "./grid";
import { beltPiece } from "./beltShape";
import { refinedBeltCells } from "./flow";
import { useFactoryModels } from "./models";

const MAX_INSTANCES = 4096;

const dummy = new THREE.Object3D();

function placeInstance(mesh: THREE.InstancedMesh, index: number, x: number, z: number, rotationY: number) {
  dummy.position.set(x, 0, z);
  dummy.rotation.set(0, rotationY, 0);
  dummy.updateMatrix();
  mesh.setMatrixAt(index, dummy.matrix);
}

function flush(mesh: THREE.InstancedMesh, count: number) {
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
}

// Factory draws placed structures as instanced models. Belts after a refiner use
// the stripe conveyor set so refined product lanes read differently from raw ones.
export function Factory() {
  const models = useFactoryModels();
  const straights = useRef<THREE.InstancedMesh>(null!);
  const corners = useRef<THREE.InstancedMesh>(null!);
  const tees = useRef<THREE.InstancedMesh>(null!);
  const crosses = useRef<THREE.InstancedMesh>(null!);
  const stripeStraights = useRef<THREE.InstancedMesh>(null!);
  const stripeCorners = useRef<THREE.InstancedMesh>(null!);
  const stripeTees = useRef<THREE.InstancedMesh>(null!);
  const stripeCrosses = useRef<THREE.InstancedMesh>(null!);
  const extractors = useRef<THREE.InstancedMesh>(null!);
  const sellers = useRef<THREE.InstancedMesh>(null!);
  const refiners = useRef<THREE.InstancedMesh>(null!);
  const snap = useSyncExternalStore(subscribe, getLatest);

  useLayoutEffect(() => {
    let nStraight = 0;
    let nCorner = 0;
    let nTee = 0;
    let nCross = 0;
    let nStripeStraight = 0;
    let nStripeCorner = 0;
    let nStripeTee = 0;
    let nStripeCross = 0;
    let nExt = 0;
    let nSeller = 0;
    let nRefiner = 0;
    if (snap) {
      const { width, height, tiles } = snap;
      const { offX, offZ } = cellOffsets(snap);
      const refined = refinedBeltCells(snap);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const tile = tiles[y * width + x];
          const wx = x - offX;
          const wz = y - offZ;
          if (tile.kind === "belt") {
            const { kind, rotationY } = beltPiece(snap, x, y, tile.dir);
            const striped = refined.has(y * width + x);
            if (striped) {
              if (kind === "corner") placeInstance(stripeCorners.current, nStripeCorner++, wx, wz, rotationY);
              else if (kind === "tee") placeInstance(stripeTees.current, nStripeTee++, wx, wz, rotationY);
              else if (kind === "cross") placeInstance(stripeCrosses.current, nStripeCross++, wx, wz, rotationY);
              else placeInstance(stripeStraights.current, nStripeStraight++, wx, wz, rotationY);
            } else if (kind === "corner") placeInstance(corners.current, nCorner++, wx, wz, rotationY);
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
    flush(stripeStraights.current, nStripeStraight);
    flush(stripeCorners.current, nStripeCorner);
    flush(stripeTees.current, nStripeTee);
    flush(stripeCrosses.current, nStripeCross);
    flush(extractors.current, nExt);
    flush(sellers.current, nSeller);
    flush(refiners.current, nRefiner);
  }, [snap]);

  const { belt, corner, tee, cross, stripe, extractor, seller, refiner } = models;

  return (
    <>
      <instancedMesh ref={straights} args={[belt.geometry, belt.material, MAX_INSTANCES]} frustumCulled={false} />
      <instancedMesh ref={corners} args={[corner.geometry, corner.material, MAX_INSTANCES]} frustumCulled={false} />
      <instancedMesh ref={tees} args={[tee.geometry, tee.material, MAX_INSTANCES]} frustumCulled={false} />
      <instancedMesh ref={crosses} args={[cross.geometry, cross.material, MAX_INSTANCES]} frustumCulled={false} />
      <instancedMesh
        ref={stripeStraights}
        args={[stripe.belt.geometry, stripe.belt.material, MAX_INSTANCES]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={stripeCorners}
        args={[stripe.corner.geometry, stripe.corner.material, MAX_INSTANCES]}
        frustumCulled={false}
      />
      <instancedMesh ref={stripeTees} args={[stripe.tee.geometry, stripe.tee.material, MAX_INSTANCES]} frustumCulled={false} />
      <instancedMesh
        ref={stripeCrosses}
        args={[stripe.cross.geometry, stripe.cross.material, MAX_INSTANCES]}
        frustumCulled={false}
      />
      <instancedMesh ref={extractors} args={[extractor.geometry, extractor.material, MAX_INSTANCES]} frustumCulled={false} />
      <instancedMesh ref={sellers} args={[seller.geometry, seller.material, MAX_INSTANCES]} frustumCulled={false} />
      <instancedMesh ref={refiners} args={[refiner.geometry, refiner.material, MAX_INSTANCES]} frustumCulled={false} />
    </>
  );
}
