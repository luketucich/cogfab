import { describe, expect, it, vi } from "vitest";
import type { TilesMessage } from "./types";

const { applyTilesSpy } = vi.hoisted(() => ({ applyTilesSpy: vi.fn() }));

vi.mock("../world/store", () => ({
  applyTiles: applyTilesSpy,
  resetLatest: vi.fn(),
  setLatest: vi.fn(),
  setResources: vi.fn(),
}));
vi.mock("../world/economy", () => ({ setStats: vi.fn() }));
vi.mock("../world/presence", () => ({ setPresence: vi.fn() }));
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
});
