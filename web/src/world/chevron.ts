import * as THREE from "three";

// chevronGeometry builds the arrow shape shared by the flowing belt arrows and
// the build cursor: a long, wide flat chevron pointing +x, lying on the floor.
// One builder so the two always look identical.
export function chevronGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0.3, 0, 0, -0.05, 0, 0.22, 0.05, 0, 0, 0.3, 0, 0, 0.05, 0, 0, -0.05, 0, -0.22], 3),
  );
  return g;
}
