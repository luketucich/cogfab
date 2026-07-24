import * as THREE from "three";

const RING_POINTS = 8;
const TAU = Math.PI * 2;

function addRing(
  positions: number[],
  size: number,
  radii: readonly number[],
  heights: readonly number[],
  offsetX = 0,
  offsetZ = 0,
): void {
  for (let i = 0; i < RING_POINTS; i++) {
    const angle = (i / RING_POINTS) * TAU;
    const radius = radii[i] * size;
    positions.push(
      Math.cos(angle) * radius + offsetX * size,
      heights[i] * size,
      Math.sin(angle) * radius + offsetZ * size,
    );
  }
}

function addRingFaces(indices: number[], lower: number, upper: number): void {
  for (let i = 0; i < RING_POINTS; i++) {
    const next = (i + 1) % RING_POINTS;
    indices.push(
      lower + i,
      upper + next,
      lower + next,
      lower + i,
      upper + i,
      upper + next,
    );
  }
}

// makeOreGeometry builds a faceted nugget with a broad, perfectly flat base.
// It can sit directly on a conveyor without tilting or intersecting the belt.
export function makeOreGeometry(size: number): THREE.BufferGeometry {
  const positions = [0, 0, 0]; // bottom centre
  const base = 1;
  addRing(
    positions,
    size,
    [0.95, 0.9, 1, 0.86, 0.97, 0.91, 0.88, 0.98],
    [0, 0, 0, 0, 0, 0, 0, 0],
  );
  const shoulder = base + RING_POINTS;
  addRing(
    positions,
    size,
    [0.86, 0.82, 0.9, 0.79, 0.87, 0.84, 0.8, 0.9],
    [0.47, 0.54, 0.5, 0.58, 0.48, 0.55, 0.52, 0.45],
    -0.02,
    0.01,
  );
  const crown = shoulder + RING_POINTS;
  addRing(
    positions,
    size,
    [0.36, 0.31, 0.39, 0.33, 0.37, 0.3, 0.35, 0.32],
    [0.94, 1.02, 0.91, 1.08, 0.96, 1.04, 0.93, 1],
    -0.08,
    0.04,
  );
  const peak = crown + RING_POINTS;
  positions.push(-0.12 * size, 1.18 * size, 0.02 * size);

  const indices: number[] = [];
  for (let i = 0; i < RING_POINTS; i++) {
    const next = (i + 1) % RING_POINTS;
    indices.push(0, base + i, base + next);
  }
  addRingFaces(indices, base, shoulder);
  addRingFaces(indices, shoulder, crown);
  for (let i = 0; i < RING_POINTS; i++) {
    const next = (i + 1) % RING_POINTS;
    indices.push(crown + i, peak, crown + next);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

// makeIngotGeometry builds the low-poly bar that leaves a refiner. Both the
// base and top are authored above y=0 so the bar rests on the same belt plane.
export function makeIngotGeometry(): THREE.BufferGeometry {
  const halfLength = 0.17;
  const halfWidth = 0.105;
  const height = 0.065;
  const bevel = 0.025;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        -halfLength,
        0,
        -halfWidth,
        halfLength,
        0,
        -halfWidth,
        halfLength,
        0,
        halfWidth,
        -halfLength,
        0,
        halfWidth,
        -halfLength + bevel,
        height,
        -halfWidth + bevel,
        halfLength - bevel,
        height,
        -halfWidth + bevel,
        halfLength - bevel,
        height,
        halfWidth - bevel,
        -halfLength + bevel,
        height,
        halfWidth - bevel,
      ],
      3,
    ),
  );
  geometry.setIndex([
    0, 1, 2, 0, 2, 3, // base
    4, 6, 5, 4, 7, 6, // top
    0, 5, 1, 0, 4, 5, // north side
    1, 6, 2, 1, 5, 6, // east end
    2, 7, 3, 2, 6, 7, // south side
    3, 4, 0, 3, 7, 4, // west end
  ]);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
