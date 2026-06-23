import { useState } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { getLatest } from "./store";
import { cellFromWorld, cellOffsets } from "./grid";

// Ground is an invisible plane that catches pointer hovers and lights up the
// cell under the cursor. First step toward placing belts and machines.
export function Ground() {
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);

  function onMove(e: ThreeEvent<PointerEvent>) {
    const snap = getLatest();
    if (!snap) return;
    const cell = cellFromWorld(e.point.x, e.point.z, snap);
    // Only re-render when the hovered cell actually changes.
    setHover((prev) => {
      if (!cell && !prev) return prev;
      if (cell && prev && cell.x === prev.x && cell.y === prev.y) return prev;
      return cell;
    });
  }

  const snap = getLatest();
  const offsets = snap ? cellOffsets(snap) : null;

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} onPointerMove={onMove} onPointerOut={() => setHover(null)}>
        <planeGeometry args={[1000, 1000]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {hover && offsets && (
        <mesh
          position={[hover.x - offsets.offX, 0.02, hover.y - offsets.offZ]}
          rotation={[-Math.PI / 2, 0, 0]}
          raycast={() => null}
        >
          <planeGeometry args={[0.96, 0.96]} />
          <meshBasicMaterial color="#6ea8ff" transparent opacity={0.28} depthWrite={false} />
        </mesh>
      )}
    </>
  );
}
