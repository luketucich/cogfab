import { describe, it, expect } from "vitest";
import { getLatest, setLatest, subscribe } from "./store";
import type { StateMessage, TileView } from "../net/types";

const snap = (kind: TileView["kind"]): StateMessage => ({
  type: "state",
  width: 1,
  height: 1,
  tiles: [{ kind, dir: "north" }],
});

describe("world store", () => {
  it("holds the latest snapshot", () => {
    setLatest(snap("belt"));
    expect(getLatest()?.tiles[0].kind).toBe("belt");

    setLatest(snap("extractor"));
    expect(getLatest()?.tiles[0].kind).toBe("extractor");
  });

  it("notifies subscribers on change and stops after unsubscribe", () => {
    let n = 0;
    const off = subscribe(() => {
      n++;
    });

    setLatest(snap("belt"));
    setLatest(snap("empty"));
    expect(n).toBe(2);

    off();
    setLatest(snap("belt"));
    expect(n).toBe(2);
  });
});
