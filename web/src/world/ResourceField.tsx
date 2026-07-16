import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import * as THREE from "three";
import { cellOffsets } from "./grid";
import { RESOURCE_PALETTE } from "./resources";
import type { ResourceKind } from "../net/types";
import { useResourceModels } from "./resourceModels";
import { getTerrain, subscribeResources } from "./store";

const MAX_CELLS = 64 * 64;
const dummy = new THREE.Object3D();
const RESOURCE_COLORS: Record<ResourceKind, THREE.Color> = {
  iron: new THREE.Color(RESOURCE_PALETTE.iron.color),
  copper: new THREE.Color(RESOURCE_PALETTE.copper.color),
  quartz: new THREE.Color(RESOURCE_PALETTE.quartz.color),
  gold: new THREE.Color(RESOURCE_PALETTE.gold.color),
};

function rockVariant(x: number, y: number): number {
  return Math.abs(x * 31 + y * 17) % 3;
}

function rockRotation(x: number, y: number): number {
  return ((x * 13 + y * 29) % 16) * (Math.PI / 8);
}

function flush(mesh: THREE.InstancedMesh, count: number): void {
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

// ResourceField draws sparse deposits and shipping ports with four instanced
// meshes, independent of the board dimensions.
export function ResourceField() {
  const rockA = useRef<THREE.InstancedMesh>(null!);
  const rockB = useRef<THREE.InstancedMesh>(null!);
  const rockC = useRef<THREE.InstancedMesh>(null!);
  const ports = useRef<THREE.InstancedMesh>(null!);
  const models = useResourceModels();
  const snap = useSyncExternalStore(subscribeResources, getTerrain);

  useLayoutEffect(() => {
    const rocks = [rockA.current, rockB.current, rockC.current];
    const counts = [0, 0, 0];
    let portCount = 0;
    if (snap) {
      const { offX, offZ } = cellOffsets(snap);
      for (const deposit of snap.deposits) {
        if (deposit.remaining <= 0) continue;
        const variant = rockVariant(deposit.x, deposit.y);
        const mesh = rocks[variant];
        const index = counts[variant]++;
        const fullness = deposit.capacity > 0 ? Math.max(0, Math.min(deposit.remaining / deposit.capacity, 1)) : 0;
        const scale = 0.62 + Math.sqrt(fullness) * 0.23;
        dummy.position.set(deposit.x - offX, 0.02, deposit.y - offZ);
        dummy.rotation.set(0, rockRotation(deposit.x, deposit.y), 0);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
        mesh.setColorAt(index, RESOURCE_COLORS[deposit.kind]);
      }
      for (const port of snap.ports) {
        dummy.position.set(port.x - offX, 0.015, port.y - offZ);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(0.9);
        dummy.updateMatrix();
        ports.current.setMatrixAt(portCount++, dummy.matrix);
      }
    }
    rocks.forEach((mesh, index) => flush(mesh, counts[index]));
    flush(ports.current, portCount);
  }, [snap]);

  return (
    <>
      {models.rocks.map((rock, index) => (
        <instancedMesh
          key={index}
          ref={index === 0 ? rockA : index === 1 ? rockB : rockC}
          args={[rock.geometry, undefined, MAX_CELLS]}
          frustumCulled={false}
          raycast={() => null}
        >
          <meshStandardMaterial color="#ffffff" roughness={0.86} metalness={0.12} flatShading />
        </instancedMesh>
      ))}
      <instancedMesh
        ref={ports}
        args={[models.port.geometry, models.port.material, MAX_CELLS]}
        frustumCulled={false}
        raycast={() => null}
      />
    </>
  );
}
