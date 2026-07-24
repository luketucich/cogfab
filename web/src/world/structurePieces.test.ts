import { describe, expect, it } from "vitest";
import { MACHINE_ROTATION } from "./grid";
import { sellerTransforms } from "./structurePieces";

describe("sellerTransforms", () => {
  it("turns the barred face away while keeping the seller mouth on the belt", () => {
    const [body, intake] = sellerTransforms("east");

    expect(body.rotationY).toBe(MACHINE_ROTATION.east + Math.PI);
    expect(body.offsetX).toBe(-0.12);
    expect(body.offsetZ).toBeCloseTo(0);
    expect(body.scale).toBe(0.82);
    expect(intake.rotationY).toBe(MACHINE_ROTATION.east + Math.PI);
    expect(intake.offsetX).toBe(0.3);
    expect(intake.offsetZ).toBeCloseTo(0);
    expect(intake.scale).toBe(0.58);
  });

  it("rotates both exact pieces together on the other axis", () => {
    const [body, intake] = sellerTransforms("north");

    expect(body.rotationY).toBe(MACHINE_ROTATION.north + Math.PI);
    expect(intake.rotationY).toBe(MACHINE_ROTATION.north + Math.PI);
    expect(body.offsetX).toBeCloseTo(0);
    expect(body.offsetZ).toBe(0.12);
    expect(intake.offsetX).toBeCloseTo(0);
    expect(intake.offsetZ).toBe(-0.3);
  });
});
