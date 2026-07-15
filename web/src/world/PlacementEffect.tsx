import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { StateMessage } from "../net/types";
import { sfx } from "../sfx";
import { beltPiece } from "./beltShape";
import { addBurst } from "./burst";
import { cellOffsets, MACHINE_ROTATION } from "./grid";
import type { FactoryModels, MeshParts } from "./models";
import { finishPlacementEffect, type PlacementEffect as Effect } from "./placementEffectStore";

const DROP_MS = 260;
const FINISH_MS = 340;
const DROP_HEIGHT = 0.5;

type Props = {
  effect: Effect;
  snap: StateMessage;
  models: FactoryModels;
};

function modelFor(effect: Effect, snap: StateMessage, models: FactoryModels): { part: MeshParts; rotationY: number } {
  if (effect.kind === "extractor") return { part: models.extractor, rotationY: MACHINE_ROTATION[effect.dir] };
  if (effect.kind === "seller") return { part: models.seller, rotationY: MACHINE_ROTATION[effect.dir] };
  const piece = beltPiece(snap, effect.x, effect.y, effect.dir);
  const part = piece.kind === "corner" ? models.corner : piece.kind === "tee" ? models.tee : piece.kind === "cross" ? models.cross : models.belt;
  return { part, rotationY: piece.rotationY };
}

// PlacementEffect drops one accepted server-side building into place, then
// hands the cell back to the static instanced factory.
export function PlacementEffect({ effect, snap, models }: Props) {
  const group = useRef<THREE.Group>(null!);
  const impacted = useRef(false);
  const finished = useRef(false);
  const { part, rotationY } = modelFor(effect, snap, models);
  const { offX, offZ } = cellOffsets(snap);

  useFrame(() => {
    if (!group.current) return;
    const elapsed = performance.now() - effect.startsAt;
    if (elapsed < 0) {
      group.current.visible = false;
      return;
    }
    group.current.visible = true;
    const progress = Math.min(elapsed / DROP_MS, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    group.current.position.y = DROP_HEIGHT * (1 - eased);
    group.current.scale.setScalar(0.9 + eased * 0.1);

    if (!impacted.current && progress >= 0.8) {
      impacted.current = true;
      addBurst({ x: effect.x - offX, z: effect.y - offZ, color: "#b8c8df", count: 7 });
      if (effect.playSound) sfx.place();
    }
    if (!finished.current && elapsed >= FINISH_MS) {
      finished.current = true;
      finishPlacementEffect(effect.id);
    }
  });

  if (!part.geometry) return null;
  return (
    <group ref={group} position={[effect.x - offX, DROP_HEIGHT, effect.y - offZ]} visible={false}>
      <mesh geometry={part.geometry} material={part.material} rotation={[0, rotationY, 0]} raycast={() => null} />
    </group>
  );
}
