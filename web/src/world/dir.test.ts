import { describe, expect, it } from "vitest";
import { clockwise } from "./dir";

describe("clockwise", () => {
  it("turns through each grid direction", () => {
    expect(clockwise("north")).toBe("east");
    expect(clockwise("east")).toBe("south");
    expect(clockwise("south")).toBe("west");
    expect(clockwise("west")).toBe("north");
  });
});
