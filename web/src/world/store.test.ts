import { describe, it, expect } from "vitest";
import { getLatest, setLatest } from "./store";
import type { StateMessage } from "../net/types";

describe("world store", () => {
  it("holds the latest snapshot", () => {
    const msg: StateMessage = {
      type: "state",
      tick: 5,
      width: 1,
      height: 1,
      tiles: [{ kind: "belt", dir: "east", item: "ore" }],
    };

    setLatest(msg);

    expect(getLatest()?.tick).toBe(5);
    expect(getLatest()?.tiles[0].item).toBe("ore");
  });

  it("replaces the snapshot on each set", () => {
    const base: StateMessage = { type: "state", tick: 1, width: 0, height: 0, tiles: [] };
    setLatest({ ...base, tick: 10 });
    setLatest({ ...base, tick: 11 });
    expect(getLatest()?.tick).toBe(11);
  });
});
