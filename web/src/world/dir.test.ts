import { describe, expect, it } from "vitest";
import { clockwise, sameAxis } from "./dir";

describe("clockwise", () => {
  it("turns through each grid direction", () => {
    expect(clockwise("north")).toBe("east");
    expect(clockwise("east")).toBe("south");
    expect(clockwise("south")).toBe("west");
    expect(clockwise("west")).toBe("north");
  });
});

describe("sameAxis", () => {
  it("ignores polarity but keeps horizontal and vertical orientations separate", () => {
    expect(sameAxis("east", "west")).toBe(true);
    expect(sameAxis("north", "south")).toBe(true);
    expect(sameAxis("east", "north")).toBe(false);
  });
});
