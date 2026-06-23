import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { getFrame } from "./store";
import { BELT_ROTATION, cellOffsets } from "./grid";
import { sourceTile } from "./interpolation";
import { useFactoryModels } from "./models";

const MAX_INSTANCES = 4096;
const ORE_SIZE = 0.34;
const ORE_HEIGHT = 0.42;

const dummy = new THREE.Object3D();

// placeInstance writes one positioned, rotated instance into a mesh.
function placeInstance(
  mesh: THREE.InstancedMesh,
  index: number,
  x: number,
  y: number,
  z: number,
  rotationY: number,
) {
  dummy.position.set(x, y, z);
  dummy.rotation.set(0, rotationY, 0);
  dummy.updateMatrix();
  mesh.setMatrixAt(index, dummy.matrix);
}

// Factory draws the grid as instanced models, updated every frame from the
// latest snapshots. The ore is interpolated between its previous and current
// tile so it glides smoothly at the render frame rate instead of jumping once
// per server tick. Reading the store here, not through React state, keeps the
// fast stream off React's render path.
export function Factory() {
  const { belt, extractor } = useFactoryModels();
  const belts = useRef<THREE.InstancedMesh>(null!);
  const extractors = useRef<THREE.InstancedMesh>(null!);
  const ore = useRef<THREE.InstancedMesh>(null!);

  useFrame(() => {
    const frame = getFrame(performance.now());
    if (!frame) return;
    const { current, previous, alpha } = frame;
    const { width, height, tiles } = current;
    const { offX, offZ } = cellOffsets(current);

    let nBelt = 0;
    let nExt = 0;
    let nOre = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tile = tiles[y * width + x];
        const rot = BELT_ROTATION[tile.dir];

        if (tile.kind === "belt") {
          placeInstance(belts.current, nBelt++, x - offX, 0, y - offZ, rot);
        } else if (tile.kind === "extractor") {
          placeInstance(extractors.current, nExt++, x - offX, 0, y - offZ, rot);
        }

        if (tile.item === "ore") {
          const [sx, sy] = previous ? sourceTile(previous, x, y) : [x, y];
          placeInstance(
            ore.current,
            nOre++,
            sx - offX + (x - sx) * alpha,
            ORE_HEIGHT,
            sy - offZ + (y - sy) * alpha,
            0,
          );
        }
      }
    }

    belts.current.count = nBelt;
    extractors.current.count = nExt;
    ore.current.count = nOre;
    belts.current.instanceMatrix.needsUpdate = true;
    extractors.current.instanceMatrix.needsUpdate = true;
    ore.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh ref={belts} args={[belt.geometry, belt.material, MAX_INSTANCES]} frustumCulled={false} />
      <instancedMesh ref={extractors} args={[extractor.geometry, extractor.material, MAX_INSTANCES]} frustumCulled={false} />
      <instancedMesh ref={ore} args={[undefined, undefined, MAX_INSTANCES]} frustumCulled={false}>
        <boxGeometry args={[ORE_SIZE, ORE_SIZE, ORE_SIZE]} />
        <meshStandardMaterial color="#5bd66f" />
      </instancedMesh>
    </>
  );
}
