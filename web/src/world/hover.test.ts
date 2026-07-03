import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { sendSpy } = vi.hoisted(() => ({ sendSpy: vi.fn() }));
vi.mock("../net/connection", () => ({ connection: { send: sendSpy } }));
vi.mock("../net/session", () => ({ subscribeSession: vi.fn(() => () => {}) }));

// hover.ts keeps throttle state at module level, so each test gets a fresh copy.
async function freshSetHover() {
  vi.resetModules();
  const mod = await import("./hover");
  return mod.setHover;
}

describe("the hover share throttle", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    sendSpy.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a changed cell right away and repeats of it never", async () => {
    const setHover = await freshSetHover();
    setHover({ x: 1, y: 2 });
    setHover({ x: 1, y: 2 }); // Ground fires this on every pointer move
    setHover({ x: 1, y: 2 });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenLastCalledWith({ type: "hover", hovering: true, x: 1, y: 2 });
  });

  it("spaces rapid changes out and always lands the final cell", async () => {
    const setHover = await freshSetHover();
    setHover({ x: 0, y: 0 }); // sent immediately
    vi.advanceTimersByTime(10);
    setHover({ x: 1, y: 0 }); // inside the window: queued
    vi.advanceTimersByTime(10);
    setHover({ x: 2, y: 0 }); // still queued; the trailing send must carry THIS one
    expect(sendSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(50);
    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(sendSpy).toHaveBeenLastCalledWith({ type: "hover", hovering: true, x: 2, y: 0 });
  });

  it("shares leaving the grid as not hovering", async () => {
    const setHover = await freshSetHover();
    setHover({ x: 1, y: 1 });
    vi.advanceTimersByTime(60);
    setHover(null);
    expect(sendSpy).toHaveBeenLastCalledWith({ type: "hover", hovering: false, x: 0, y: 0 });
  });
});
