import { describe, expect, it } from "vitest";
import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM } from "../camera";
import { stepTooltipSpring, tooltipHorizontalShift, tooltipMotion, tooltipScale } from "./overlayScale";

describe("tooltipScale", () => {
  it("keeps text readable at the far zoom limit", () => {
    expect(tooltipScale(MIN_ZOOM)).toBe(0.78);
    expect(tooltipScale(MIN_ZOOM - 100)).toBe(0.78);
  });

  it("grows smoothly without becoming oversized", () => {
    expect(tooltipScale(DEFAULT_ZOOM)).toBeCloseTo(0.8826667);
    expect(tooltipScale(MAX_ZOOM)).toBe(1);
    expect(tooltipScale(MAX_ZOOM + 100)).toBe(1);
  });
});

describe("tooltipHorizontalShift", () => {
  it("leaves a tooltip centred over its building when it clears both HUD columns", () => {
    expect(tooltipHorizontalShift(640, 160, 220, 1070)).toBe(0);
  });

  it("moves a tooltip just past either HUD column at the zoomed-in edges", () => {
    expect(tooltipHorizontalShift(250, 160, 220, 1070)).toBe(60);
    expect(tooltipHorizontalShift(1040, 160, 220, 1070)).toBe(-60);
  });

  it("does not invent a shift when the viewport is too narrow", () => {
    expect(tooltipHorizontalShift(300, 200, 250, 400)).toBe(0);
  });
});

describe("tooltip motion", () => {
  it("springs past the resting point before settling", () => {
    let spring = { value: 0, velocity: 0 };
    let peak = 0;
    for (let frame = 0; frame < 120; frame++) {
      spring = stepTooltipSpring(spring, true, 1 / 60);
      peak = Math.max(peak, spring.value);
    }

    expect(peak).toBeGreaterThan(1);
    expect(spring.value).toBeCloseTo(1, 3);
    expect(Math.abs(spring.velocity)).toBeLessThan(0.01);
  });

  it("uses a softer exit and fully settles out", () => {
    let spring = { value: 1, velocity: 0 };
    spring = stepTooltipSpring(spring, false, 1 / 60);
    expect(spring.value).toBeLessThan(1);
    expect(spring.value).toBeGreaterThan(0);

    for (let frame = 0; frame < 120; frame++) {
      spring = stepTooltipSpring(spring, false, 1 / 60);
    }
    expect(spring).toEqual({ value: 0, velocity: 0 });
  });

  it("combines the spring with zoom without changing the final anchor", () => {
    const hidden = tooltipMotion(0, 0.8);
    expect(hidden.opacity).toBe(0);
    expect(hidden.offset).toBe(2);
    expect(hidden.scale).toBeCloseTo(0.736);
    expect(tooltipMotion(1, 0.8)).toEqual({ opacity: 1, offset: 8, scale: 0.8 });
    expect(tooltipMotion(1.1, 1).scale).toBeCloseTo(1.008);
  });
});
