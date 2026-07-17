import { describe, expect, it, vi } from "vitest";
import type { BuildPreviewMessage, CursorMessage, TilesMessage } from "./types";

const { applyTilesSpy, setCursorSpy, setPresencePreviewSpy } = vi.hoisted(() => ({
  applyTilesSpy: vi.fn(),
  setCursorSpy: vi.fn(),
  setPresencePreviewSpy: vi.fn(),
}));

vi.mock("../world/store", () => ({
  applyTiles: applyTilesSpy,
  resetLatest: vi.fn(),
  setLatest: vi.fn(),
  setResources: vi.fn(),
}));
vi.mock("../world/economy", () => ({ setStats: vi.fn() }));
vi.mock("../world/presence", () => ({
  setCursor: setCursorSpy,
  setPresence: vi.fn(),
  setPresencePreview: setPresencePreviewSpy,
}));
vi.mock("./session", () => ({ setRoomFull: vi.fn(), setSession: vi.fn() }));
vi.mock("./ping", () => ({ setPing: vi.fn() }));

import { handleServerMessage } from "./connection";

describe("server message routing", () => {
  it("routes one atomic tile batch to the world store", () => {
    const message: TilesMessage = {
      type: "tiles",
      tiles: [
        { x: 2, y: 3, kind: "belt", dir: "east" },
        { x: 3, y: 3, kind: "seller", dir: "west" },
      ],
    };

    handleServerMessage(message);

    expect(applyTilesSpy).toHaveBeenCalledOnce();
    expect(applyTilesSpy).toHaveBeenCalledWith(message);
  });

  it("routes compact cursor and preview updates independently", () => {
    const cursor: CursorMessage = { type: "cursor", slot: 1, on: true, sx: 0.2, sy: 0.3, hovering: true, x: 4.5, y: 6.5 };
    const buildPreview: BuildPreviewMessage = {
      type: "buildPreview",
      slot: 1,
      preview: { kind: "belt", placements: [{ x: 4, y: 6, dir: "east" }] },
    };

    handleServerMessage(cursor);
    handleServerMessage(buildPreview);

    expect(setCursorSpy).toHaveBeenCalledOnce();
    expect(setCursorSpy).toHaveBeenCalledWith(cursor);
    expect(setPresencePreviewSpy).toHaveBeenCalledOnce();
    expect(setPresencePreviewSpy).toHaveBeenCalledWith(buildPreview);
  });
});
