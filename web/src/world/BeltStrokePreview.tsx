import { useMemo } from "react";
import * as THREE from "three";
import { ACCENT, DANGER } from "../ui";
import type { BeltPlacement, StateMessage } from "../net/types";
import { chevronGeometry, CHEVRON_ROT } from "./chevron";
import { cellOffsets, CURSOR_TILE } from "./grid";

const TILE_Y = 0.025;
const ARROW_Y = 0.09;

type Props = {
  placements: BeltPlacement[];
  valid: boolean;
  snap: StateMessage | null;
};

// BeltStrokePreview shows the complete local drag before it becomes a server
// command. Blue can be placed; red means the whole stroke will be rejected.
export function BeltStrokePreview({ placements, valid, snap }: Props) {
  const arrow = useMemo(() => chevronGeometry(), []);
  if (!snap || placements.length === 0) return null;

  const color = valid ? ACCENT : DANGER;
  const { offX, offZ } = cellOffsets(snap);
  return (
    <group>
      {placements.map((placement) => (
        <group key={`${placement.x}:${placement.y}`} position={[placement.x - offX, 0, placement.y - offZ]}>
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, TILE_Y, 0]}
            scale={[CURSOR_TILE, CURSOR_TILE, 1]}
            raycast={() => null}
          >
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial color={color} transparent opacity={0.38} depthWrite={false} toneMapped={false} />
          </mesh>
          <mesh
            geometry={arrow}
            position={[0, ARROW_Y, 0]}
            rotation={[0, CHEVRON_ROT[placement.dir], 0]}
            raycast={() => null}
          >
            <meshBasicMaterial
              color={color}
              transparent
              opacity={0.92}
              depthWrite={false}
              side={THREE.DoubleSide}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}
