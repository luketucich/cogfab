import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { getLatest } from "./store";
import { getHover } from "./hover";
import { getSelectedId } from "../toolbar/tools";
import { cellOffsets, MACHINE_ROTATION } from "./grid";
import { beltPiece } from "./beltShape";
import { useFactoryModels, type FactoryModels } from "./models";
import type { StateMessage } from "../net/types";

const FADE = 12; // how fast the glow fades in and out
const OPACITY = 0.45; // glow strength
const SCALE = 1.04; // a hair larger than the model, so it reads as an aura
const BUILD = new THREE.Color("#7fc1ff"); // hovering with a build tool
const DESTROY = new THREE.Color("#ff6b6b"); // hovering with the destroy tool

type Piece = { geometry: THREE.BufferGeometry; rotationY: number };

// structureAt returns the model geometry and rotation the factory draws on a
// cell, or null if the cell is empty. Same belt-piece resolver Factory uses, so
// the glow always matches the structure exactly.
function structureAt(snap: StateMessage, models: FactoryModels, x: number, y: number): Piece | null {
  const tile = snap.tiles[y * snap.width + x];
  if (tile.kind === "belt") {
    const { kind, rotationY } = beltPiece(snap, x, y, tile.dir);
    const part = kind === "corner" ? models.corner : kind === "tee" ? models.tee : kind === "cross" ? models.cross : models.belt;
    return part.geometry ? { geometry: part.geometry, rotationY } : null;
  }
  if (tile.kind === "extractor" && models.extractor.geometry) return { geometry: models.extractor.geometry, rotationY: MACHINE_ROTATION[tile.dir] };
  if (tile.kind === "seller" && models.seller.geometry) return { geometry: models.seller.geometry, rotationY: MACHINE_ROTATION[tile.dir] };
  return null;
}

// HoverGlow lights up the structure under the cursor: an additive copy of the
// exact model the factory draws, fading in over whatever you point at. Red for
// the destroy tool, blue otherwise. Empty cells get nothing here (Ground
// previews those with a tile and an arrow).
export function HoverGlow() {
  const models = useFactoryModels();
  const mesh = useRef<THREE.Mesh>(null!);
  const mat = useRef<THREE.MeshBasicMaterial>(null!);
  const shown = useRef(0); // 0..1 presence, drives the fade

  useFrame((_, delta) => {
    const snap = getLatest();
    const cell = getHover();
    const piece = snap && cell ? structureAt(snap, models, cell.x, cell.y) : null;
    if (piece && snap && cell) {
      const { offX, offZ } = cellOffsets(snap);
      mesh.current.geometry = piece.geometry;
      mesh.current.position.set(cell.x - offX, 0, cell.y - offZ);
      mesh.current.rotation.y = piece.rotationY;
      mat.current.color = getSelectedId() === "destroy" ? DESTROY : BUILD;
    }
    shown.current = THREE.MathUtils.damp(shown.current, piece ? 1 : 0, FADE, delta);
    mesh.current.visible = shown.current > 0.001;
    mat.current.opacity = OPACITY * shown.current;
  });

  return (
    <mesh ref={mesh} scale={SCALE} visible={false} raycast={() => null}>
      <meshBasicMaterial ref={mat} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}
