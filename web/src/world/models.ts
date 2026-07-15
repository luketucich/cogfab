import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

export type MeshParts = { geometry?: THREE.BufferGeometry; material?: THREE.Material };

const CONVEYOR_URL = "/models/conveyor.glb";
const CONVEYOR_CORNER_URL = "/models/conveyor-corner.glb";
const CONVEYOR_TEE_URL = "/models/conveyor-junction-t.glb";
const CONVEYOR_CROSS_URL = "/models/conveyor-cross.glb";
const MACHINE_URL = "/models/machine.glb";
const HOPPER_URL = "/models/hopper-square.glb";

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

export type FactoryModels = {
  belt: MeshParts;
  corner: MeshParts;
  tee: MeshParts;
  cross: MeshParts;
  extractor: MeshParts;
  seller: MeshParts;
};

// useFactoryModels loads the building models once and returns their drawable parts.
// The extractor is the machine; the seller is a hopper (a funnel materials drop into).
export function useFactoryModels(): FactoryModels {
  const conveyor = useGLTF(CONVEYOR_URL);
  const conveyorCorner = useGLTF(CONVEYOR_CORNER_URL);
  const conveyorTee = useGLTF(CONVEYOR_TEE_URL);
  const conveyorCross = useGLTF(CONVEYOR_CROSS_URL);
  const machine = useGLTF(MACHINE_URL);
  const hopper = useGLTF(HOPPER_URL);
  const belt = useMemo(() => firstMesh(conveyor.scene), [conveyor.scene]);
  const corner = useMemo(() => firstMesh(conveyorCorner.scene), [conveyorCorner.scene]);
  const tee = useMemo(() => firstMesh(conveyorTee.scene), [conveyorTee.scene]);
  const cross = useMemo(() => firstMesh(conveyorCross.scene), [conveyorCross.scene]);
  const extractor = useMemo(() => firstMesh(machine.scene), [machine.scene]);
  const seller = useMemo(() => firstMesh(hopper.scene), [hopper.scene]);
  return { belt, corner, tee, cross, extractor, seller };
}

useGLTF.preload(CONVEYOR_URL);
useGLTF.preload(CONVEYOR_CORNER_URL);
useGLTF.preload(CONVEYOR_TEE_URL);
useGLTF.preload(CONVEYOR_CROSS_URL);
useGLTF.preload(MACHINE_URL);
useGLTF.preload(HOPPER_URL);
