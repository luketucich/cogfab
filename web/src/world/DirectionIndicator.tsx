import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Dir } from "../net/types";
import { CHEVRON_ROT, chevronGeometry } from "./chevron";

const ARROW = chevronGeometry();
const ARROW_OUTLINE = new THREE.EdgesGeometry(ARROW, 1);
const ECHO_COUNT = 2;

type Props = {
  direction: Dir;
  y: number;
  scale?: number;
};

// DirectionIndicator is the shared facing cue for previews and placed machines.
export function DirectionIndicator({ direction, y, scale = 1.25 }: Props) {
  const pulse = useRef<THREE.Group>(null!);
  const arrowMaterial = useRef<THREE.MeshBasicMaterial>(null!);
  const echoes = useRef<(THREE.Group | null)[]>([]);
  const echoMaterials = useRef<(THREE.LineBasicMaterial | null)[]>([]);

  useFrame(({ clock }) => {
    const time = clock.elapsedTime;
    const glow = (Math.sin(time * Math.PI * 2) + 1) / 2;
    pulse.current.scale.setScalar(scale * (0.98 + glow * 0.04));
    arrowMaterial.current.opacity = 0.82 + glow * 0.16;

    echoes.current.forEach((echo, index) => {
      const material = echoMaterials.current[index];
      if (!echo || !material) return;
      const progress = (time * 0.65 + index / ECHO_COUNT) % 1;
      echo.scale.setScalar(1 + progress * 0.3);
      material.opacity = 0.16 * (1 - progress) ** 2;
    });
  });

  return (
    <group position={[0, y, 0]} rotation={[0, CHEVRON_ROT[direction], 0]} dispose={null}>
      <group ref={pulse}>
        <mesh geometry={ARROW} renderOrder={10} raycast={() => null}>
          <meshBasicMaterial
            ref={arrowMaterial}
            color="#ffffff"
            transparent
            opacity={1}
            depthTest={false}
            depthWrite={false}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
        {Array.from({ length: ECHO_COUNT }, (_, index) => (
          <group
            key={index}
            ref={(group) => {
              echoes.current[index] = group;
            }}
          >
            <lineSegments geometry={ARROW_OUTLINE} renderOrder={9} raycast={() => null}>
              <lineBasicMaterial
                ref={(material) => {
                  echoMaterials.current[index] = material;
                }}
                color="#ffffff"
                transparent
                opacity={0}
                depthTest={false}
                depthWrite={false}
                toneMapped={false}
              />
            </lineSegments>
          </group>
        ))}
      </group>
    </group>
  );
}
