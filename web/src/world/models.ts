import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

type MeshParts = { geometry?: THREE.BufferGeometry; material?: THREE.Material };

const CONVEYOR_URL = "/models/conveyor.glb";
const MACHINE_URL = "/models/machine.glb";

// firstMesh pulls the geometry and material out of a loaded model, so we can
// draw many copies of it with a single instanced mesh.
function firstMesh(scene: THREE.Object3D): MeshParts {
  let geometry: THREE.BufferGeometry | undefined;
  let material: THREE.Material | undefined;
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh && !geometry) {
      geometry = mesh.geometry;
      material = mesh.material as THREE.Material;
    }
  });
  return { geometry, material };
}

// useFactoryModels loads the building models once and returns their drawable parts.
export function useFactoryModels(): { belt: MeshParts; extractor: MeshParts } {
  const conveyor = useGLTF(CONVEYOR_URL);
  const machine = useGLTF(MACHINE_URL);
  const belt = useMemo(() => firstMesh(conveyor.scene), [conveyor.scene]);
  const extractor = useMemo(() => firstMesh(machine.scene), [machine.scene]);
  return { belt, extractor };
}

useGLTF.preload(CONVEYOR_URL);
useGLTF.preload(MACHINE_URL);
