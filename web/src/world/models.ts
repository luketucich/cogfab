import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

export type MeshParts = { geometry?: THREE.BufferGeometry; material?: THREE.Material };

const CONVEYOR_URL = "/models/conveyor.glb";
const CONVEYOR_CORNER_URL = "/models/conveyor-corner.glb";
const CONVEYOR_TEE_URL = "/models/conveyor-junction-t.glb";
const CONVEYOR_CROSS_URL = "/models/conveyor-cross.glb";
const STRIPE_URL = "/models/conveyor-stripe.glb";
const STRIPE_CORNER_URL = "/models/conveyor-stripe-corner.glb";
const STRIPE_TEE_URL = "/models/conveyor-stripe-junction-t.glb";
const STRIPE_CROSS_URL = "/models/conveyor-stripe-cross.glb";
const EXTRACTOR_URL = "/models/extractor.glb";
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

export type BeltModelSet = {
  belt: MeshParts;
  corner: MeshParts;
  tee: MeshParts;
  cross: MeshParts;
};

export type FactoryModels = BeltModelSet & {
  stripe: BeltModelSet;
  extractor: MeshParts;
  seller: MeshParts;
  refiner: MeshParts;
};

// useFactoryModels loads the building models once and returns their drawable parts.
// Extractors use the windowed machine, sellers the hopper, refiners the fortified
// machine. Stripe conveyors mark belts that carry refined products.
export function useFactoryModels(): FactoryModels {
  const conveyor = useGLTF(CONVEYOR_URL);
  const conveyorCorner = useGLTF(CONVEYOR_CORNER_URL);
  const conveyorTee = useGLTF(CONVEYOR_TEE_URL);
  const conveyorCross = useGLTF(CONVEYOR_CROSS_URL);
  const stripe = useGLTF(STRIPE_URL);
  const stripeCorner = useGLTF(STRIPE_CORNER_URL);
  const stripeTee = useGLTF(STRIPE_TEE_URL);
  const stripeCross = useGLTF(STRIPE_CROSS_URL);
  const extractorGltf = useGLTF(EXTRACTOR_URL);
  const hopper = useGLTF(HOPPER_URL);
  const refiner = useGLTF(REFINER_URL);

  const belt = useMemo(() => meshParts(conveyor.scene), [conveyor.scene]);
  const corner = useMemo(() => meshParts(conveyorCorner.scene), [conveyorCorner.scene]);
  const tee = useMemo(() => meshParts(conveyorTee.scene), [conveyorTee.scene]);
  const cross = useMemo(() => meshParts(conveyorCross.scene), [conveyorCross.scene]);
  const stripeBelt = useMemo(() => meshParts(stripe.scene), [stripe.scene]);
  const stripeCornerParts = useMemo(() => meshParts(stripeCorner.scene), [stripeCorner.scene]);
  const stripeTeeParts = useMemo(() => meshParts(stripeTee.scene), [stripeTee.scene]);
  const stripeCrossParts = useMemo(() => meshParts(stripeCross.scene), [stripeCross.scene]);
  const extractor = useMemo(() => meshParts(extractorGltf.scene), [extractorGltf.scene]);
  const seller = useMemo(() => meshParts(hopper.scene), [hopper.scene]);
  const refinerParts = useMemo(() => meshParts(refiner.scene), [refiner.scene]);

  return {
    belt,
    corner,
    tee,
    cross,
    stripe: {
      belt: stripeBelt,
      corner: stripeCornerParts,
      tee: stripeTeeParts,
      cross: stripeCrossParts,
    },
    extractor,
    seller,
    refiner: refinerParts,
  };
}

for (const url of [
  CONVEYOR_URL,
  CONVEYOR_CORNER_URL,
  CONVEYOR_TEE_URL,
  CONVEYOR_CROSS_URL,
  STRIPE_URL,
  STRIPE_CORNER_URL,
  STRIPE_TEE_URL,
  STRIPE_CROSS_URL,
  EXTRACTOR_URL,
  HOPPER_URL,
  REFINER_URL,
]) {
  useGLTF.preload(url);
}
