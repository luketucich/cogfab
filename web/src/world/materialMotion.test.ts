import { describe, expect, it } from "vitest";
import { spacedBehind } from "./materialMotion";

describe("material spacing", () => {
  it("leaves the leading item unchanged", () => {
    expect(spacedBehind(undefined, 3, 0.5)).toBe(3);
  });

  it("queues a following item without overlap", () => {
    expect(spacedBehind(3, 2.8, 0.5)).toBe(2.5);
    expect(spacedBehind(3, 2, 0.5)).toBe(2);
  });

  it("trims visual overflow behind the extractor", () => {
    expect(spacedBehind(0.4, 0.1, 0.5)).toBeNull();
  });
});
