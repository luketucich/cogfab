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
const REFINER_URL = "/models/refiner.glb";

// meshParts pulls the geometry and material out of a loaded model, so we can
// draw many copies of it with a single instanced mesh.
export function meshParts(scene: THREE.Object3D): MeshParts {
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
  refiner: MeshParts;
};

// useFactoryModels loads the building models once and returns their drawable parts.
// The extractor is the machine; the seller is a hopper; the refiner is the
// fortified machine from the Kenney Factory Kit.
export function useFactoryModels(): FactoryModels {
  const conveyor = useGLTF(CONVEYOR_URL);
  const conveyorCorner = useGLTF(CONVEYOR_CORNER_URL);
  const conveyorTee = useGLTF(CONVEYOR_TEE_URL);
  const conveyorCross = useGLTF(CONVEYOR_CROSS_URL);
  const machine = useGLTF(MACHINE_URL);
  const hopper = useGLTF(HOPPER_URL);
  const refiner = useGLTF(REFINER_URL);
  const belt = useMemo(() => meshParts(conveyor.scene), [conveyor.scene]);
  const corner = useMemo(() => meshParts(conveyorCorner.scene), [conveyorCorner.scene]);
  const tee = useMemo(() => meshParts(conveyorTee.scene), [conveyorTee.scene]);
  const cross = useMemo(() => meshParts(conveyorCross.scene), [conveyorCross.scene]);
  const extractor = useMemo(() => meshParts(machine.scene), [machine.scene]);
  const seller = useMemo(() => meshParts(hopper.scene), [hopper.scene]);
  const refinerParts = useMemo(() => meshParts(refiner.scene), [refiner.scene]);
  return { belt, corner, tee, cross, extractor, seller, refiner: refinerParts };
}

useGLTF.preload(CONVEYOR_URL);
useGLTF.preload(CONVEYOR_CORNER_URL);
useGLTF.preload(CONVEYOR_TEE_URL);
useGLTF.preload(CONVEYOR_CROSS_URL);
useGLTF.preload(MACHINE_URL);
useGLTF.preload(HOPPER_URL);
useGLTF.preload(REFINER_URL);
