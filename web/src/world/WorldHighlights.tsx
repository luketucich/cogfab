import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { getBuildPreview } from "./buildPreviewStore";
import { getStats } from "./economy";
import { cellOffsets, CURSOR_TILE, unlockedRect } from "./grid";
import { highlightTarget } from "./highlightTarget";
import { getHover } from "./hover";
import { useFactoryModels, type FactoryModels } from "./models";
import { getPresence, getPreviewPresence } from "./presence";
import { getLatest } from "./store";
import { getSession } from "../net/session";
import { PLAYER_COLORS } from "../ui";
import { placedStructurePieces } from "./structurePieces";

const TILE_Y = 0.03;
const FADE = 12;
const OPACITY = 0.4;

type VisibleKind = "tile" | "structure" | null;

function HighlightSlot({ slot, models }: { slot: number; models: FactoryModels }) {
  const tile = useRef<THREE.Mesh>(null!);
  const primary = useRef<THREE.Mesh>(null!);
  const secondary = useRef<THREE.Mesh>(null!);
  const shown = useRef(0);
  const lastKind = useRef<VisibleKind>(null);
  const pieceCount = useRef(0);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: PLAYER_COLORS[slot],
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    [slot],
  );

  useEffect(() => () => material.dispose(), [material]);

  useFrame((_, delta) => {
    const snap = getLatest();
    let kind: VisibleKind = null;
    if (snap) {
      const stats = getStats();
      const target = highlightTarget({
        snap,
        unlocked: unlockedRect(snap, stats.gridWidth, stats.gridHeight),
        slot,
        localSlot: getSession().slot,
        localHover: getHover(),
        localPreview: getBuildPreview(),
        players: getPresence(),
        previewPlayers: getPreviewPresence(),
      });
      if (target) {
        const index = target.y * snap.width + target.x;
        const { offX, offZ } = cellOffsets(snap);
        material.color.set(target.color);
        if (snap.tiles[index].kind === "empty") {
          tile.current.position.set(target.x - offX, TILE_Y, target.y - offZ);
          kind = "tile";
        } else {
          const pieces = placedStructurePieces(snap, models, target.x, target.y);
          const meshes = [primary.current, secondary.current];
          pieces.forEach((piece, pieceIndex) => {
            const mesh = meshes[pieceIndex];
            mesh.geometry = piece.part.geometry;
            mesh.position.set(
              target.x - offX + piece.offsetX,
              0,
              target.y - offZ + piece.offsetZ,
            );
            mesh.rotation.y = piece.rotationY;
            mesh.scale.setScalar(piece.scale);
          });
          pieceCount.current = pieces.length;
          if (pieces.length) kind = "structure";
        }
      }
    }

    if (kind) lastKind.current = kind;
    shown.current = THREE.MathUtils.damp(shown.current, kind ? 1 : 0, FADE, delta);
    material.opacity = OPACITY * shown.current;
    const visible = shown.current > 0.001;
    tile.current.visible = visible && lastKind.current === "tile";
    primary.current.visible = visible && lastKind.current === "structure" && pieceCount.current > 0;
    secondary.current.visible = visible && lastKind.current === "structure" && pieceCount.current > 1;
  });

  return (
    <>
      <mesh
        ref={tile}
        material={material}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[CURSOR_TILE, CURSOR_TILE, 1]}
        visible={false}
        raycast={() => null}
      >
        <planeGeometry args={[1, 1]} />
      </mesh>
      <mesh ref={primary} material={material} visible={false} raycast={() => null} />
      <mesh ref={secondary} material={material} visible={false} raycast={() => null} />
    </>
  );
}

// WorldHighlights gives every player the same clean, model-flush hover effect.
// The local player reads white; collaborators see that exact animation tinted
// with the player's chosen room colour.
export function WorldHighlights() {
  const models = useFactoryModels();
  return (
    <>
      {PLAYER_COLORS.map((_, slot) => (
        <HighlightSlot key={slot} slot={slot} models={models} />
      ))}
    </>
  );
}
