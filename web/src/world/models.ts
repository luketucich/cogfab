import { useMemo } from "react";
import { useGLTF, useTexture } from "@react-three/drei";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type MeshParts = { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] };

const CONVEYOR_URL = "/models/conveyor.glb";
const CONVEYOR_CORNER_URL = "/models/conveyor-corner.glb";
const CONVEYOR_TEE_URL = "/models/conveyor-junction-t.glb";
const CONVEYOR_CROSS_URL = "/models/conveyor-cross.glb";
const EXTRACTOR_URL = "/models/extractor-window.glb";
const SELLER_URL = "/models/seller-window.glb";
const SELLER_INTAKE_URL = "/models/seller-intake.glb";
const REFINER_URL = "/models/refiner.glb";
const SELLER_PALETTE_URL = "/models/Textures/seller-colormap.png";
const REFINER_PALETTE_URL = "/models/Textures/refiner-colormap.png";

// meshParts bakes every mesh in a loaded model into one grouped geometry. Some
// Kenney machines use a second transparent material for their windows; keeping
// every primitive preserves those details while structures remain instanced.
export function meshParts(scene: THREE.Object3D): MeshParts {
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  scene.updateMatrixWorld(true);
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (meshMaterials.length !== 1) {
      throw new Error(`model mesh ${mesh.name || "unnamed"} has unsupported grouped materials`);
    }
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    geometries.push(geometry);
    materials.push(meshMaterials[0]);
  });
  if (geometries.length === 0) throw new Error("model has no drawable mesh");
  if (geometries.length === 1) return { geometry: geometries[0], material: materials[0] };
  const geometry = mergeGeometries(geometries, true);
  if (!geometry) throw new Error("model meshes could not be merged");
  return { geometry, material: materials };
}

// rolePalette keeps the Factory Kit texture and shading intact while giving a
// machine family its own casing colours. Glass stays a separate material so a
// seller can carry the same cool collection tint through its window.
function rolePalette(parts: MeshParts, texture: THREE.Texture, glassColor?: string): MeshParts {
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  const source = Array.isArray(parts.material) ? parts.material : [parts.material];
  const materials = source.map((material) => {
    const clone = material.clone();
    if (clone instanceof THREE.MeshStandardMaterial && clone.name === "colormap") {
      clone.map = texture;
      clone.color.set("#ffffff");
      clone.needsUpdate = true;
    } else if (glassColor && clone instanceof THREE.MeshStandardMaterial && clone.name === "material-glass") {
      clone.color.set(glassColor);
    }
    return clone;
  });
  return {
    geometry: parts.geometry,
    material: Array.isArray(parts.material) ? materials : materials[0],
  };
}

export type FactoryModels = {
  belt: MeshParts;
  corner: MeshParts;
  tee: MeshParts;
  cross: MeshParts;
  extractor: MeshParts;
  seller: MeshParts;
  sellerIntake: MeshParts;
  refiner: MeshParts;
};

// useFactoryModels loads the building models once and returns their drawable parts.
// Each machine is a real Kenney Factory Kit asset: windowed machines for the
// extractor and seller, and an enclosed two-sided processor for the refiner.
export function useFactoryModels(): FactoryModels {
  const conveyor = useGLTF(CONVEYOR_URL);
  const conveyorCorner = useGLTF(CONVEYOR_CORNER_URL);
  const conveyorTee = useGLTF(CONVEYOR_TEE_URL);
  const conveyorCross = useGLTF(CONVEYOR_CROSS_URL);
  const extractorModel = useGLTF(EXTRACTOR_URL);
  const sellerModel = useGLTF(SELLER_URL);
  const sellerIntakeModel = useGLTF(SELLER_INTAKE_URL);
  const refiner = useGLTF(REFINER_URL);
  const sellerPalette = useTexture(SELLER_PALETTE_URL);
  const refinerPalette = useTexture(REFINER_PALETTE_URL);
  const belt = useMemo(() => meshParts(conveyor.scene), [conveyor.scene]);
  const corner = useMemo(() => meshParts(conveyorCorner.scene), [conveyorCorner.scene]);
  const tee = useMemo(() => meshParts(conveyorTee.scene), [conveyorTee.scene]);
  const cross = useMemo(() => meshParts(conveyorCross.scene), [conveyorCross.scene]);
  const extractor = useMemo(() => meshParts(extractorModel.scene), [extractorModel.scene]);
  const seller = useMemo(
    () => rolePalette(meshParts(sellerModel.scene), sellerPalette, "#b8ffe5"),
    [sellerModel.scene, sellerPalette],
  );
  const sellerIntake = useMemo(
    () => rolePalette(meshParts(sellerIntakeModel.scene), sellerPalette),
    [sellerIntakeModel.scene, sellerPalette],
  );
  const refinerParts = useMemo(
    () => rolePalette(meshParts(refiner.scene), refinerPalette),
    [refiner.scene, refinerPalette],
  );
  return { belt, corner, tee, cross, extractor, seller, sellerIntake, refiner: refinerParts };
}

useGLTF.preload(CONVEYOR_URL);
useGLTF.preload(CONVEYOR_CORNER_URL);
useGLTF.preload(CONVEYOR_TEE_URL);
useGLTF.preload(CONVEYOR_CROSS_URL);
useGLTF.preload(EXTRACTOR_URL);
useGLTF.preload(SELLER_URL);
useGLTF.preload(SELLER_INTAKE_URL);
useGLTF.preload(REFINER_URL);
useTexture.preload(SELLER_PALETTE_URL);
useTexture.preload(REFINER_PALETTE_URL);
