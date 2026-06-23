import { describe, it, expect } from "vitest";
import { getFrame, getLatest, setLatest } from "./store";
import type { StateMessage } from "../net/types";

const base: StateMessage = {
  type: "state",
  tick: 0,
  width: 1,
  height: 1,
  tiles: [{ kind: "belt", dir: "east", item: "none" }],
};

describe("world store", () => {
  it("holds the latest snapshot", () => {
    setLatest({ ...base, tick: 5, tiles: [{ kind: "belt", dir: "east", item: "ore" }] });
    expect(getLatest()?.tick).toBe(5);
    expect(getLatest()?.tiles[0].item).toBe("ore");
  });

  it("replaces the snapshot on each set", () => {
    setLatest({ ...base, tick: 10 });
    setLatest({ ...base, tick: 11 });
    expect(getLatest()?.tick).toBe(11);
  });

  it("reports interpolation progress between the two latest snapshots", () => {
    setLatest({ ...base, tick: 1 }, 1000);
    setLatest({ ...base, tick: 2 }, 1250); // 250ms later

    expect(getFrame(1250)?.alpha).toBe(0);
    expect(getFrame(1375)?.alpha).toBeCloseTo(0.5);
    expect(getFrame(5000)?.alpha).toBe(1); // clamped
    expect(getFrame(1250)?.current.tick).toBe(2);
    expect(getFrame(1250)?.previous?.tick).toBe(1);
  });
});
