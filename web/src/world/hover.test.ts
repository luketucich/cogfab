import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { sendSpy } = vi.hoisted(() => ({ sendSpy: vi.fn() }));
vi.mock("../net/connection", () => ({ connection: { send: sendSpy } }));
vi.mock("../net/session", () => ({ subscribeSession: vi.fn(() => () => {}) }));

// hover.ts keeps throttle state at module level, so each test gets a fresh copy.
async function fresh() {
  vi.resetModules();
  return await import("./hover");
}

describe("the cursor share throttle", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    sendSpy.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a moved mouse right away and a still one never", async () => {
    const { pointerMoved } = await fresh();
    pointerMoved(0.3, 0.4);
    pointerMoved(0.3, 0.4); // the window fires this on every twitch
    pointerMoved(0.301, 0.401); // a wiggle below the threshold
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenLastCalledWith({ type: "hover", on: true, sx: 0.3, sy: 0.4, hovering: false, cx: 0, cy: 0 });
  });

  it("spaces rapid movement out and always lands the final spot", async () => {
    const { pointerMoved } = await fresh();
    pointerMoved(0.1, 0.5); // sent immediately
    vi.advanceTimersByTime(10);
    pointerMoved(0.2, 0.5); // inside the window: queued
    vi.advanceTimersByTime(10);
    pointerMoved(0.3, 0.5); // still queued; the trailing send must carry THIS spot
    expect(sendSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(50);
    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(sendSpy).toHaveBeenLastCalledWith({ type: "hover", on: true, sx: 0.3, sy: 0.5, hovering: false, cx: 0, cy: 0 });
  });

  it("carries the grid spot along when the mouse is over a cell", async () => {
    const { pointerMoved, setHover } = await fresh();
    pointerMoved(0.5, 0.5);
    vi.advanceTimersByTime(60);
    setHover({ x: 1, y: 2 }, { x: 1.4, y: 2.1 }); // entering a cell counts as movement
    expect(sendSpy).toHaveBeenLastCalledWith({ type: "hover", on: true, sx: 0.5, sy: 0.5, hovering: true, cx: 1.4, cy: 2.1 });
  });

  it("shares leaving the grid and leaving the screen", async () => {
    const { pointerMoved, pointerLeft, setHover } = await fresh();
    pointerMoved(0.5, 0.5);
    vi.advanceTimersByTime(60);
    setHover({ x: 1, y: 1 }, { x: 1.5, y: 1.5 });
    vi.advanceTimersByTime(60);
    setHover(null);
    expect(sendSpy).toHaveBeenLastCalledWith({ type: "hover", on: true, sx: 0.5, sy: 0.5, hovering: false, cx: 1.5, cy: 1.5 });

    vi.advanceTimersByTime(60);
    pointerLeft();
    expect(sendSpy).toHaveBeenLastCalledWith({ type: "hover", on: false, sx: 0.5, sy: 0.5, hovering: false, cx: 1.5, cy: 1.5 });
  });
});
