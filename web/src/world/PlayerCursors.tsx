import { useRef, useSyncExternalStore } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { getLatest, subscribe } from "./store";
import { getPresence } from "./presence";
import { getSession } from "../net/session";
import { cellOffsets } from "./grid";
import { PLAYER_COLORS, playerColor } from "../ui";

const TILE = 0.96; // match the build cursor's footprint
const TILE_Y = 0.03; // a hair above the build preview, so both can show
const OPACITY = 0.3;
const FOLLOW = 14; // glide speed between cells: visibly smooth, never laggy
const FADE = 10;

// PlayerCursors marks the grid cell each other player's mouse is over: a
// translucent tile in their colour, gliding between cells like the build
// cursor. The mouse pointer itself is drawn over the page by CursorOverlay;
// this is the world-anchored half, which stays correct however differently
// everyone's camera is panned. Our own slot is skipped.
export function PlayerCursors() {
  const group = useRef<THREE.Group>(null!);
  const mats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const snap = useSyncExternalStore(subscribe, getLatest);

  useFrame((_, delta) => {
    if (!snap) return;
    const { offX, offZ } = cellOffsets(snap);
    const roster = getPresence();
    const mySlot = getSession().slot;

    // One pre-created tile per player slot; each frame it chases its player's
    // hovered cell and fades out when that player leaves the grid.
    group.current.children.forEach((tile, slot) => {
      const mat = mats.current[slot];
      if (!mat) return;
      const player = roster.find((p) => p.slot === slot && p.hovering && slot !== mySlot);
      mat.opacity = THREE.MathUtils.damp(mat.opacity, player ? OPACITY : 0, FADE, delta);
      tile.visible = mat.opacity > 0.005;
      if (!player) return;

      mat.color.set(playerColor(player));
      const tx = Math.round(player.x) - offX; // the cell the cursor is over
      const tz = Math.round(player.y) - offZ;
      if (tile.visible && mat.opacity > 0.01) {
        tile.position.x = THREE.MathUtils.damp(tile.position.x, tx, FOLLOW, delta);
        tile.position.z = THREE.MathUtils.damp(tile.position.z, tz, FOLLOW, delta);
      } else {
        tile.position.set(tx, TILE_Y, tz); // fading in: appear on the cell, no glide from afar
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
