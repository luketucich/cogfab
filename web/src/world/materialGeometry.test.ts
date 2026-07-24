import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { makeIngotGeometry, makeOreGeometry } from "./materialGeometry";

describe("material geometry", () => {
  it("gives ore a broad flat base on the conveyor plane", () => {
    const geometry = makeOreGeometry(0.13);
    const positions = geometry.getAttribute("position");
    const baseVertices = Array.from({ length: positions.count }, (_, i) => positions.getY(i)).filter(
      (y) => Math.abs(y) < 1e-6,
    );

    expect(geometry.boundingBox?.min.y).toBeCloseTo(0);
    expect(geometry.boundingBox?.max.y).toBeGreaterThan(0.14);
    expect(baseVertices).toHaveLength(9);
  });

  it("authors the ingot above a flat base instead of around its centre", () => {
    const geometry = makeIngotGeometry();

    expect(geometry.boundingBox?.min.y).toBeCloseTo(0);
    expect(geometry.boundingBox?.max.y).toBeCloseTo(0.065);
  });

  it("winds the ingot top outward so its solid surface renders from above", () => {
    const geometry = makeIngotGeometry();
    const positions = geometry.getAttribute("position");
    const index = geometry.getIndex()!;
    const a = new THREE.Vector3().fromBufferAttribute(positions, index.getX(6));
    const b = new THREE.Vector3().fromBufferAttribute(positions, index.getX(7));
    const c = new THREE.Vector3().fromBufferAttribute(positions, index.getX(8));
    const normal = b.clone().sub(a).cross(c.clone().sub(a));

    expect(normal.y).toBeGreaterThan(0);
  });
});
