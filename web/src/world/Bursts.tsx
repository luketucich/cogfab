import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { drainBursts } from "./burst";

const MAX_PARTICLES = 512;
const SIZE = 0.055; // particle radius
const GRAVITY = -9;
const SPAWN_Y = 0.25;

// One flying speck: position, velocity, and how much life it has left.
type Particle = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number; // seconds remaining
  ttl: number; // full lifetime, for the shrink
  color: THREE.Color;
};

// Bursts renders every queued particle puff: placement dust, destroy debris,
// and the sparkle when ore lands in a seller. Purely cosmetic; each particle
// pops up, falls under gravity, and shrinks away.
export function Bursts() {
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const particles = useRef<Particle[]>([]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const geometry = useMemo(() => new THREE.IcosahedronGeometry(SIZE, 0), []);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), []);

  useFrame((_, delta) => {
    // Spawn everything queued since last frame.
    for (const b of drainBursts()) {
      const color = new THREE.Color(b.color);
      for (let i = 0; i < b.count && particles.current.length < MAX_PARTICLES; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = (b.radius ?? 0) * (0.82 + Math.random() * 0.18);
        const speed = 0.6 + Math.random() * 1.2;
        const ttl = 0.35 + Math.random() * 0.25;
        particles.current.push({
          x: b.x + Math.cos(angle) * radius,
          y: b.y ?? SPAWN_Y,
          z: b.z + Math.sin(angle) * radius,
          vx: Math.cos(angle) * speed,
          vy: 2 + Math.random() * 2,
          vz: Math.sin(angle) * speed,
          life: ttl,
          ttl,
          color,
        });
      }
    }

    // Fly, fall, shrink, die.
    const step = Math.min(delta, 0.1); // a hitching tab must not teleport them
    const alive: Particle[] = [];
    for (const p of particles.current) {
      p.life -= step;
      if (p.life <= 0) continue;
      p.vy += GRAVITY * step;
      p.x += p.vx * step;
      p.y += p.vy * step;
      p.z += p.vz * step;
      if (p.y < 0) continue; // fell through the floor: done
      alive.push(p);
    }
    particles.current = alive;

    let inst = 0;
    for (const p of alive) {
      dummy.position.set(p.x, p.y, p.z);
      dummy.scale.setScalar(p.life / p.ttl); // shrink out
      dummy.updateMatrix();
      mesh.current.setMatrixAt(inst, dummy.matrix);
      mesh.current.setColorAt(inst, p.color);
      inst++;
    }
    mesh.current.count = inst;
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  });

  return <instancedMesh ref={mesh} args={[geometry, material, MAX_PARTICLES]} frustumCulled={false} />;
}
