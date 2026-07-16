import { useRef, useSyncExternalStore } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { getLatest, subscribe } from "./store";
import { getPresence } from "./presence";
import { getSession } from "../net/session";
import { getBuildPreview } from "./buildPreviewStore";
import { cellIndex, cellOffsets, CURSOR_TILE, isUnlocked, unlockedRect } from "./grid";
import { getHover } from "./hover";
import { getStats } from "./economy";
import { PLAYER_COLORS, playerColor } from "../ui";

const TILE = CURSOR_TILE;
const TILE_Y = 0.03;
const OPACITY = 0.3;
const FOLLOW = 14; // glide speed between cells: visibly smooth, never laggy
const FADE = 10;

type CursorTile = { x: number; y: number; color: string };

// PlayerCursors tints an empty hovered tile when that player has no active
// building preview. Screen-space pointers are rendered separately.
export function PlayerCursors() {
  const group = useRef<THREE.Group>(null!);
  const mats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const snap = useSyncExternalStore(subscribe, getLatest);

  useFrame((_, delta) => {
    if (!snap) return;
    const { offX, offZ } = cellOffsets(snap);
    const stats = getStats();
    const unlocked = unlockedRect(snap, stats.gridWidth, stats.gridHeight);
    const roster = getPresence();
    const mySlot = getSession().slot;

    group.current.children.forEach((tile, slot) => {
      const mat = mats.current[slot];
      if (!mat) return;
      let cursor: CursorTile | null = null;
      if (slot === mySlot) {
        const cell = getHover();
        const me = roster.find((player) => player.slot === slot);
        if (cell && !getBuildPreview()) {
          cursor = { x: cell.x, y: cell.y, color: me ? playerColor(me) : PLAYER_COLORS[slot] };
        }
      } else {
        const player = roster.find((candidate) => candidate.slot === slot && candidate.hovering && !candidate.preview);
        if (player) cursor = { x: Math.round(player.x), y: Math.round(player.y), color: playerColor(player) };
      }

      if (cursor) {
        const index = cellIndex(snap, cursor.x, cursor.y);
        if (!isUnlocked(unlocked, cursor.x, cursor.y) || index < 0 || snap.tiles[index].kind !== "empty") cursor = null;
      }

      const wasVisible = mat.opacity > 0.005;
      mat.opacity = THREE.MathUtils.damp(mat.opacity, cursor ? OPACITY : 0, FADE, delta);
      tile.visible = mat.opacity > 0.005;
      if (!cursor) return;

      mat.color.set(cursor.color);
      const tx = cursor.x - offX;
      const tz = cursor.y - offZ;
      if (wasVisible) {
        tile.position.x = THREE.MathUtils.damp(tile.position.x, tx, FOLLOW, delta);
        tile.position.z = THREE.MathUtils.damp(tile.position.z, tz, FOLLOW, delta);
      } else {
        tile.position.set(tx, TILE_Y, tz);
      }
    });
  });

  return (
    <group ref={group}>
      {PLAYER_COLORS.map((color, slot) => (
        <mesh key={slot} rotation={[-Math.PI / 2, 0, 0]} position={[0, TILE_Y, 0]} scale={[TILE, TILE, 1]} visible={false} raycast={() => null}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            ref={(m) => {
              mats.current[slot] = m;
            }}
            color={color}
            transparent
            opacity={0}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}
