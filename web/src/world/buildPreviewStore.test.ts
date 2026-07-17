import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BuildPreview } from "../net/types";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  sessionListener: null as (() => void) | null,
}));

vi.mock("../net/connection", () => ({ connection: { send: mocks.send } }));
vi.mock("../net/session", () => ({
  subscribeSession: vi.fn((listener: () => void) => {
    mocks.sessionListener = listener;
    return () => {};
  }),
}));

function preview(x: number): BuildPreview {
  return { kind: "belt", placements: [{ x, y: 2, dir: "east" }] };
}

async function freshStore() {
  vi.resetModules();
  return await import("./buildPreviewStore");
}

describe("build preview sharing", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    mocks.send.mockClear();
    mocks.sessionListener = null;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("keeps the local ghost immediate while trailing the latest network value", async () => {
    const store = await freshStore();
    const listener = vi.fn();
    store.subscribeBuildPreview(listener);

    store.setBuildPreview(preview(1));
    vi.advanceTimersByTime(10);
    store.setBuildPreview(preview(2));
    vi.advanceTimersByTime(10);
    store.setBuildPreview(preview(3));

    expect(store.getBuildPreview()).toEqual(preview(3));
    expect(listener).toHaveBeenCalledTimes(3);
    expect(mocks.send).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30);
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.send).toHaveBeenLastCalledWith({ type: "preview", kind: "belt", placements: preview(3).placements });
  });

  it("sends clears immediately and cancels a queued preview", async () => {
    const store = await freshStore();
    store.setBuildPreview(preview(1));
    vi.advanceTimersByTime(10);
    store.setBuildPreview(preview(2));

    store.setBuildPreview(null);

    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.send).toHaveBeenLastCalledWith({ type: "preview", kind: "", placements: [] });
    vi.advanceTimersByTime(100);
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });

  it("restores the latest preview immediately after reconnecting", async () => {
    const store = await freshStore();
    store.setBuildPreview(preview(1));
    vi.advanceTimersByTime(10);
    store.setBuildPreview(preview(2));

    mocks.sessionListener?.();

    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.send).toHaveBeenLastCalledWith({ type: "preview", kind: "belt", placements: preview(2).placements });
    vi.advanceTimersByTime(100);
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });
});
