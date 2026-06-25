import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import * as THREE from "three";
import { getLatest, subscribe } from "./store";
import { BELT_ROTATION, cellOffsets } from "./grid";
import { useFactoryModels } from "./models";

const MAX_INSTANCES = 4096;

const dummy = new THREE.Object3D();

// placeInstance writes one positioned, rotated instance into a mesh.
function placeInstance(
  mesh: THREE.InstancedMesh,
  index: number,
  x: number,
  z: number,
  rotationY: number,
) {
  dummy.position.set(x, 0, z);
  dummy.rotation.set(0, rotationY, 0);
  dummy.updateMatrix();
  mesh.setMatrixAt(index, dummy.matrix);
}

// Factory draws the placed structures as instanced models. Nothing moves, so it
// rebuilds the instances only when a new snapshot arrives, not every frame.
export function Factory() {
  const { belt, extractor } = useFactoryModels();
  const belts = useRef<THREE.InstancedMesh>(null!);
  const extractors = useRef<THREE.InstancedMesh>(null!);
  const snap = useSyncExternalStore(subscribe, getLatest);

  useLayoutEffect(() => {
    let nBelt = 0;
    let nExt = 0;
    if (snap) {
      const { width, height, tiles } = snap;
      const { offX, offZ } = cellOffsets(snap);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const tile = tiles[y * width + x];
          const rot = BELT_ROTATION[tile.dir];
          if (tile.kind === "belt") {
            placeInstance(belts.current, nBelt++, x - offX, y - offZ, rot);
          } else if (tile.kind === "extractor") {
            placeInstance(extractors.current, nExt++, x - offX, y - offZ, rot);
          }
        }
      }
    }
    belts.current.count = nBelt;
    extractors.current.count = nExt;
    belts.current.instanceMatrix.needsUpdate = true;
    extractors.current.instanceMatrix.needsUpdate = true;
  }, [snap]);

  return (
    <>
      <instancedMesh ref={belts} args={[belt.geometry, belt.material, MAX_INSTANCES]} frustumCulled={false} />
      <instancedMesh ref={extractors} args={[extractor.geometry, extractor.material, MAX_INSTANCES]} frustumCulled={false} />
    </>
  );
}
