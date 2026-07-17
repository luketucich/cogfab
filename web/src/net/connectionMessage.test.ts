import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionResultMessage, BuildPreviewMessage, CursorMessage, TilesMessage } from "./types";

const { applyTilesSpy, denySpy, resolveActionSpy, setCursorSpy, setPresencePreviewSpy, settleSpendSpy } = vi.hoisted(() => ({
  applyTilesSpy: vi.fn(),
  denySpy: vi.fn(),
  resolveActionSpy: vi.fn(),
  setCursorSpy: vi.fn(),
  setPresencePreviewSpy: vi.fn(),
  settleSpendSpy: vi.fn(),
}));

vi.mock("../world/store", () => ({
  applyTiles: applyTilesSpy,
  clearPredictions: vi.fn(),
  predictAction: vi.fn(),
  resetLatest: vi.fn(),
  resolveAction: resolveActionSpy,
  setLatest: vi.fn(),
  setResources: vi.fn(),
}));
vi.mock("../world/economy", () => ({
  clearPendingSpend: vi.fn(),
  releaseSpend: vi.fn(),
  reserveSpend: vi.fn(),
  setStats: vi.fn(),
  settleSpend: settleSpendSpy,
}));
vi.mock("../world/presence", () => ({
  setCursor: setCursorSpy,
  setPresence: vi.fn(),
  setPresencePreview: setPresencePreviewSpy,
}));
vi.mock("./session", () => ({ setRoomFull: vi.fn(), setSession: vi.fn() }));
vi.mock("./ping", () => ({ setPing: vi.fn() }));
vi.mock("../sfx", () => ({ sfx: { deny: denySpy } }));

import { handleServerMessage } from "./connection";

describe("server message routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it("settles one predicted action by its ID", () => {
    resolveActionSpy.mockReturnValue(true);
    settleSpendSpy.mockReturnValue(true);
    const message: ActionResultMessage = { type: "actionResult", actionId: 17, applied: true, credits: 825 };

    handleServerMessage(message);

    expect(resolveActionSpy).toHaveBeenCalledWith(17);
    expect(settleSpendSpy).toHaveBeenCalledWith(17, 825);
    expect(denySpy).not.toHaveBeenCalled();
  });

  it("plays one denial for a rejected known action", () => {
    resolveActionSpy.mockReturnValue(true);
    settleSpendSpy.mockReturnValue(true);
    const message: ActionResultMessage = { type: "actionResult", actionId: 18, applied: false, credits: 900 };

    handleServerMessage(message);

    expect(denySpy).toHaveBeenCalledOnce();
  });

  it("ignores a stale rejected result after reconnect", () => {
    resolveActionSpy.mockReturnValue(false);
    settleSpendSpy.mockReturnValue(false);

    handleServerMessage({ type: "actionResult", actionId: 99, applied: false, credits: 900 });

    expect(denySpy).not.toHaveBeenCalled();
  });
});
