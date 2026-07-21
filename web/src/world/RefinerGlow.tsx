import { useMemo, useRef, useSyncExternalStore } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { cellOffsets } from "./grid";
import { getLatest, subscribe } from "./store";
import { getRefinerJobs, subscribeRefinerJobs } from "./feedback";

const RING_Y = 1.55;
const RING_RADIUS = 0.55;

// RefinerGlow draws a pulsing ring above each refiner that is mid-job. Progress
// shrinks the ring as the job finishes so the wait is readable without HUD text.
export function RefinerGlow() {
  const snap = useSyncExternalStore(subscribe, getLatest);
  const jobs = useSyncExternalStore(subscribeRefinerJobs, getRefinerJobs);
  const group = useRef<THREE.Group>(null!);
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#7fc1ff",
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  const geo = useMemo(() => new THREE.RingGeometry(RING_RADIUS * 0.72, RING_RADIUS, 32), []);

  useFrame(({ clock }) => {
    if (!group.current || !snap) return;
    const { offX, offZ } = cellOffsets(snap);
    const pulse = 0.85 + Math.sin(clock.elapsedTime * 6) * 0.15;
    const children = group.current.children;
    for (let i = 0; i < children.length; i++) {
      const mesh = children[i] as THREE.Mesh;
      const job = jobs[i];
      if (!job) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.position.set(job.x - offX, RING_Y, job.y - offZ);
      const scale = pulse * (0.55 + job.progress * 0.45);
      mesh.scale.setScalar(scale);
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.35 + job.progress * 0.4;
    }
  });

  return (
    <group ref={group}>
      {Array.from({ length: 16 }, (_, i) => (
        <mesh key={i} geometry={geo} material={mat} rotation={[-Math.PI / 2, 0, 0]} visible={false} />
      ))}
    </group>
  );
}
