import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { getLatest } from "./store";

// Plenty of headroom for our grid; instances past the live count are hidden.
const MAX_INSTANCES = 4096;

// One reusable transform, filled in per instance each frame.
const dummy = new THREE.Object3D();

// Factory draws the grid as instanced boxes and repositions them every frame
// from the latest snapshot. Reading the store here, rather than through React
// state, keeps the fast stream off React's render path.
export function Factory() {
  const belts = useRef<THREE.InstancedMesh>(null!);
  const extractors = useRef<THREE.InstancedMesh>(null!);
  const ore = useRef<THREE.InstancedMesh>(null!);

  useFrame(() => {
    const snap = getLatest();
    if (!snap) return;

    const { width, height, tiles } = snap;
    const offX = (width - 1) / 2;
    const offZ = (height - 1) / 2;

    let nBelt = 0;
    let nExt = 0;
    let nOre = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tile = tiles[y * width + x];
        const wx = x - offX;
        const wz = y - offZ;

        if (tile.kind === "belt") {
          dummy.position.set(wx, 0.08, wz);
          dummy.updateMatrix();
          belts.current.setMatrixAt(nBelt++, dummy.matrix);
        } else if (tile.kind === "extractor") {
          dummy.position.set(wx, 0.25, wz);
          dummy.updateMatrix();
          extractors.current.setMatrixAt(nExt++, dummy.matrix);
        }

        if (tile.item === "ore") {
          dummy.position.set(wx, 0.45, wz);
          dummy.updateMatrix();
          ore.current.setMatrixAt(nOre++, dummy.matrix);
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
      <instancedMesh
        ref={belts}
        args={[undefined, undefined, MAX_INSTANCES]}
        frustumCulled={false}
      >
        <boxGeometry args={[0.9, 0.16, 0.9]} />
        <meshStandardMaterial color="#3b4250" />
      </instancedMesh>

      <instancedMesh
        ref={extractors}
        args={[undefined, undefined, MAX_INSTANCES]}
        frustumCulled={false}
      >
        <boxGeometry args={[0.7, 0.5, 0.7]} />
        <meshStandardMaterial color="#c0883c" />
      </instancedMesh>

      <instancedMesh
        ref={ore}
        args={[undefined, undefined, MAX_INSTANCES]}
        frustumCulled={false}
      >
        <boxGeometry args={[0.32, 0.32, 0.32]} />
        <meshStandardMaterial color="#5bd66f" />
      </instancedMesh>
    </>
  );
}
