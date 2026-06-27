import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

type MeshParts = { geometry?: THREE.BufferGeometry; material?: THREE.Material };

const CONVEYOR_URL = "/models/conveyor.glb";
const CONVEYOR_CORNER_URL = "/models/conveyor-corner.glb";
const CONVEYOR_TEE_URL = "/models/conveyor-junction-t.glb";
const CONVEYOR_CROSS_URL = "/models/conveyor-cross.glb";
const MACHINE_URL = "/models/machine.glb";

// SELLER_TINT recolours the reused machine model so a seller reads apart from an
// extractor. A dedicated model can replace this later.
const SELLER_TINT = "#54d98c";

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

// tint clones a model's material and multiplies it by a colour, so one mesh can
// stand in for a differently coloured structure.
function tint(parts: MeshParts, color: string): MeshParts {
  if (!parts.material) return parts;
  const material = parts.material.clone();
  (material as THREE.MeshStandardMaterial).color = new THREE.Color(color);
  return { geometry: parts.geometry, material };
}

type FactoryModels = {
  belt: MeshParts;
  corner: MeshParts;
  tee: MeshParts;
  cross: MeshParts;
  extractor: MeshParts;
  seller: MeshParts;
};

// useFactoryModels loads the building models once and returns their drawable parts.
export function useFactoryModels(): FactoryModels {
  const conveyor = useGLTF(CONVEYOR_URL);
  const conveyorCorner = useGLTF(CONVEYOR_CORNER_URL);
  const conveyorTee = useGLTF(CONVEYOR_TEE_URL);
  const conveyorCross = useGLTF(CONVEYOR_CROSS_URL);
  const machine = useGLTF(MACHINE_URL);
  const belt = useMemo(() => firstMesh(conveyor.scene), [conveyor.scene]);
  const corner = useMemo(() => firstMesh(conveyorCorner.scene), [conveyorCorner.scene]);
  const tee = useMemo(() => firstMesh(conveyorTee.scene), [conveyorTee.scene]);
  const cross = useMemo(() => firstMesh(conveyorCross.scene), [conveyorCross.scene]);
  const extractor = useMemo(() => firstMesh(machine.scene), [machine.scene]);
  const seller = useMemo(() => tint(firstMesh(machine.scene), SELLER_TINT), [machine.scene]);
  return { belt, corner, tee, cross, extractor, seller };
}

useGLTF.preload(CONVEYOR_URL);
useGLTF.preload(CONVEYOR_CORNER_URL);
useGLTF.preload(CONVEYOR_TEE_URL);
useGLTF.preload(CONVEYOR_CROSS_URL);
useGLTF.preload(MACHINE_URL);
