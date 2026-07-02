import { useSyncExternalStore } from "react";
import * as THREE from "three";
import { getLatest, subscribe } from "./store";
import { getStats, subscribeStats } from "./economy";
import { cellOffsets, unlockedRect } from "./grid";
import { ACCENT } from "../ui";

const EXTENT = 400; // how far the dim spreads; farther than any zoom can see
const DIM_OPACITY = 0.4;
const EDGE = 0.07; // border line thickness, in world units
const DIM_Y = 0.01; // just above the floor
const EDGE_Y = 0.02;

// Region shades everything outside the unlocked rectangle and frames what the
// players own, so the land you can build on reads at a glance. It grows the
// moment a Grid Size purchase lands.
export function Region() {
  const snap = useSyncExternalStore(subscribe, getLatest);
  // Subscribe to just the region size, so the ~1/sec stats updates do not
  // re-render this until a Grid Size purchase actually changes it.
  const size = useSyncExternalStore(subscribeStats, () => `${getStats().gridWidth}x${getStats().gridHeight}`);
  const [gridW, gridH] = size.split("x").map(Number);
  if (!snap || gridW === 0) return null;

  const rect = unlockedRect(snap, gridW, gridH);
  const { offX, offZ } = cellOffsets(snap);
  const left = rect.x0 - offX - 0.5;
  const right = rect.x1 - offX + 0.5;
  const top = rect.y0 - offZ - 0.5;
  const bottom = rect.y1 - offZ + 0.5;

  // Four bands cover the world outside the rect with no overlap: full-width
  // above and below, then side strips spanning just the rect's rows.
  const bands: [number, number, number, number][] = [
    [0, (top - EXTENT) / 2, 2 * EXTENT, EXTENT + top], // north
    [0, (bottom + EXTENT) / 2, 2 * EXTENT, EXTENT - bottom], // south
    [(left - EXTENT) / 2, (top + bottom) / 2, EXTENT + left, bottom - top], // west
    [(right + EXTENT) / 2, (top + bottom) / 2, EXTENT - right, bottom - top], // east
  ];

  // Four thin strips draw the border; the horizontal pair runs long to fill
  // the corners.
  const edges: [number, number, number, number][] = [
    [(left + right) / 2, top, right - left + 2 * EDGE, EDGE],
    [(left + right) / 2, bottom, right - left + 2 * EDGE, EDGE],
    [left, (top + bottom) / 2, EDGE, bottom - top],
    [right, (top + bottom) / 2, EDGE, bottom - top],
  ];

  return (
    <group>
      {bands.map(([x, z, w, d], i) => (
        <mesh key={`dim${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[x, DIM_Y, z]} raycast={() => null}>
          <planeGeometry args={[w, d]} />
          <meshBasicMaterial color="#000000" transparent opacity={DIM_OPACITY} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
      {edges.map(([x, z, w, d], i) => (
        <mesh key={`edge${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[x, EDGE_Y, z]} raycast={() => null}>
          <planeGeometry args={[w, d]} />
          <meshBasicMaterial
            color={ACCENT}
            transparent
            opacity={0.5}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}
