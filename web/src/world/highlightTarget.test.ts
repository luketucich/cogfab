import { describe, expect, it } from "vitest";
import type { PresencePlayer, StateMessage } from "../net/types";
import { highlightTarget, LOCAL_HIGHLIGHT_COLOR } from "./highlightTarget";

const snap: StateMessage = {
  type: "state",
  width: 3,
  height: 3,
  tiles: Array.from({ length: 9 }, () => ({ kind: "empty" as const, dir: "north" as const })),
  deposits: [],
  ports: [],
};
const unlocked = { x0: 0, y0: 0, x1: 2, y1: 2 };
const player = (overrides: Partial<PresencePlayer> = {}): PresencePlayer => ({
  slot: 1,
  name: "Peer",
  color: "#31d0aa",
  on: true,
  sx: 0.5,
  sy: 0.5,
  hovering: true,
  x: 1.2,
  y: 1.4,
  ...overrides,
});

describe("highlightTarget", () => {
  it("uses neutral white for local hover intent", () => {
    expect(
      highlightTarget({
        snap,
        unlocked,
        slot: 0,
        localSlot: 0,
        localHover: { x: 1, y: 2 },
        localPreview: null,
        players: [],
        previewPlayers: [],
      }),
    ).toEqual({ x: 1, y: 2, color: LOCAL_HIGHLIGHT_COLOR });
  });

  it("uses the remote player's chosen colour for the same cell intent", () => {
    expect(
      highlightTarget({
        snap,
        unlocked,
        slot: 1,
        localSlot: 0,
        localHover: null,
        localPreview: null,
        players: [player()],
        previewPlayers: [player()],
      }),
    ).toEqual({ x: 1, y: 1, color: "#31d0aa" });
  });

  it("does not stack hover effects over local or remote build previews", () => {
    const preview = { kind: "belt" as const, placements: [{ x: 1, y: 1, dir: "north" as const }] };
    const args = {
      snap,
      unlocked,
      localSlot: 0,
      localHover: { x: 1, y: 1 },
      localPreview: preview,
      players: [player()],
      previewPlayers: [player({ preview })],
    };
    expect(highlightTarget({ ...args, slot: 0 })).toBeNull();
    expect(highlightTarget({ ...args, slot: 1 })).toBeNull();
  });

  it("rejects stale remote coordinates outside the usable grid", () => {
    expect(
      highlightTarget({
        snap,
        unlocked,
        slot: 1,
        localSlot: 0,
        localHover: null,
        localPreview: null,
        players: [player({ x: 99, y: -20 })],
        previewPlayers: [],
      }),
    ).toBeNull();
  });
});
