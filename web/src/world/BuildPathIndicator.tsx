import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Placement } from "../net/types";
import { STEP } from "./dir";

const SHAFT_WIDTH = 0.09;
const HEAD_LENGTH = 0.36;
const HEAD_WIDTH = 0.34;
const TAIL_LENGTH = 0.22;
const ECHO_COUNT = 2;

type Props = {
  placements: Placement[];
  offX: number;
  offZ: number;
  y: number;
  color: string;
};

type Point = { x: number; z: number };

function addTriangle(vertices: number[], a: Point, b: Point, c: Point): void {
  vertices.push(a.x, 0, a.z, b.x, 0, b.z, c.x, 0, c.z);
}

function addSegment(vertices: number[], a: Point, b: Point): void {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  if (length === 0) return;
  const px = (-dz / length) * (SHAFT_WIDTH / 2);
  const pz = (dx / length) * (SHAFT_WIDTH / 2);
  const aLeft = { x: a.x + px, z: a.z + pz };
  const aRight = { x: a.x - px, z: a.z - pz };
  const bLeft = { x: b.x + px, z: b.z + pz };
  const bRight = { x: b.x - px, z: b.z - pz };
  addTriangle(vertices, aLeft, aRight, bLeft);
  addTriangle(vertices, aRight, bRight, bLeft);
}

function addJoint(vertices: number[], point: Point): void {
  const radius = SHAFT_WIDTH * 0.62;
  const sides = 8;
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const b = ((i + 1) / sides) * Math.PI * 2;
    addTriangle(
      vertices,
      point,
      { x: point.x + Math.cos(a) * radius, z: point.z + Math.sin(a) * radius },
      { x: point.x + Math.cos(b) * radius, z: point.z + Math.sin(b) * radius },
    );
  }
}

function buildGeometry(placements: Placement[], offX: number, offZ: number): { geometry: THREE.BufferGeometry; center: Point } {
  const points = placements.map((placement) => ({ x: placement.x - offX, z: placement.y - offZ }));
  const endPlacement = placements[placements.length - 1];
  const [endDx, endDz] = STEP[endPlacement.dir];
  const firstDirection =
    points.length > 1
      ? { x: points[1].x - points[0].x, z: points[1].z - points[0].z }
      : { x: endDx, z: endDz };
  const start = {
    x: points[0].x - firstDirection.x * TAIL_LENGTH,
    z: points[0].z - firstDirection.z * TAIL_LENGTH,
  };
  const shaftPoints = [start, ...points];
  const vertices: number[] = [];

  for (let i = 1; i < shaftPoints.length; i++) addSegment(vertices, shaftPoints[i - 1], shaftPoints[i]);
  for (const point of points) addJoint(vertices, point);

  const end = points[points.length - 1];
  const base = { x: end.x - endDx * 0.04, z: end.z - endDz * 0.04 };
  const tip = { x: base.x + endDx * HEAD_LENGTH, z: base.z + endDz * HEAD_LENGTH };
  const sideX = -endDz * (HEAD_WIDTH / 2);
  const sideZ = endDx * (HEAD_WIDTH / 2);
  addTriangle(
    vertices,
    tip,
    { x: base.x + sideX, z: base.z + sideZ },
    { x: base.x - sideX, z: base.z - sideZ },
  );

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const center = { x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2 };
  geometry.translate(-center.x, 0, -center.z);
  return { geometry, center };
}

// BuildPathIndicator draws one continuous arrow over an entire build drag.
export function BuildPathIndicator({ placements, offX, offZ, y, color }: Props) {
  const path = useMemo(() => buildGeometry(placements, offX, offZ), [placements, offX, offZ]);
  const pulse = useRef<THREE.Group>(null!);
  const mainMaterial = useRef<THREE.MeshBasicMaterial>(null!);
  const echoes = useRef<(THREE.Group | null)[]>([]);
  const echoMaterials = useRef<(THREE.MeshBasicMaterial | null)[]>([]);

  useEffect(() => () => path.geometry.dispose(), [path.geometry]);

  useFrame(({ clock }) => {
    const time = clock.elapsedTime;
    const glow = (Math.sin(time * Math.PI * 2) + 1) / 2;
    pulse.current.scale.setScalar(1 + glow * 0.008);
    mainMaterial.current.opacity = 0.82 + glow * 0.14;

    echoes.current.forEach((echo, index) => {
      const material = echoMaterials.current[index];
      if (!echo || !material) return;
      const progress = (time * 0.55 + index / ECHO_COUNT) % 1;
      echo.scale.setScalar(1.02 + progress * 0.04);
      material.opacity = 0.1 * (1 - progress) ** 2;
    });
  });

  return (
    <group position={[path.center.x, y, path.center.z]}>
      {Array.from({ length: ECHO_COUNT }, (_, index) => (
        <group
          key={index}
          ref={(group) => {
            echoes.current[index] = group;
          }}
        >
          <mesh geometry={path.geometry} renderOrder={9 + index} raycast={() => null}>
            <meshBasicMaterial
              ref={(material) => {
                echoMaterials.current[index] = material;
              }}
              color={color}
              transparent
              opacity={0}
              depthTest={false}
              depthWrite={false}
              side={THREE.DoubleSide}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
      <group ref={pulse}>
        <mesh geometry={path.geometry} renderOrder={11} raycast={() => null}>
          <meshBasicMaterial
            ref={mainMaterial}
            color={color}
            transparent
            opacity={0.9}
            depthTest={false}
            depthWrite={false}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      </group>
    </group>
  );
}
