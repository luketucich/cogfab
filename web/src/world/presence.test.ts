import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BuildPreview, PresencePlayer } from "../net/types";
import {
  getPresence,
  getPreviewPresence,
  setCursor,
  setPresence,
  setPresencePreview,
  subscribePresence,
  subscribePreviewPresence,
} from "./presence";

function player(slot: number, preview?: BuildPreview): PresencePlayer {
  return {
    slot,
    name: `Player ${slot + 1}`,
    color: "",
    on: false,
    sx: 0,
    sy: 0,
    hovering: false,
    x: 0,
    y: 0,
    preview,
  };
}

describe("presence store", () => {
  beforeEach(() => setPresence([]));

  it("updates cursors without changing or notifying the preview snapshot", () => {
    setPresence([player(0), player(1)]);
    const previousPresence = getPresence();
    const previousPreviews = getPreviewPresence();
    const presenceListener = vi.fn();
    const previewListener = vi.fn();
    const stopPresence = subscribePresence(presenceListener);
    const stopPreviews = subscribePreviewPresence(previewListener);

    setCursor({ type: "cursor", slot: 1, on: true, sx: 0.25, sy: 0.75, hovering: true, x: 4.5, y: 6.5 });

    expect(getPresence()).not.toBe(previousPresence);
    expect(getPresence()[1]).toMatchObject({ on: true, sx: 0.25, sy: 0.75, hovering: true, x: 4.5, y: 6.5 });
    expect(getPreviewPresence()).toBe(previousPreviews);
    expect(presenceListener).toHaveBeenCalledOnce();
    expect(previewListener).not.toHaveBeenCalled();
    stopPresence();
    stopPreviews();
  });

  it("updates previews without changing or notifying the cursor snapshot", () => {
    setPresence([player(0), player(1)]);
    const previousPresence = getPresence();
    const previousPreviews = getPreviewPresence();
    const presenceListener = vi.fn();
    const previewListener = vi.fn();
    const stopPresence = subscribePresence(presenceListener);
    const stopPreviews = subscribePreviewPresence(previewListener);
    const preview: BuildPreview = { kind: "belt", placements: [{ x: 2, y: 3, dir: "east" }] };

    setPresencePreview({ type: "buildPreview", slot: 1, preview });

    expect(getPresence()).toBe(previousPresence);
    expect(getPreviewPresence()).not.toBe(previousPreviews);
    expect(getPreviewPresence()[1].preview).toEqual(preview);
    expect(presenceListener).not.toHaveBeenCalled();
    expect(previewListener).toHaveBeenCalledOnce();
    stopPresence();
    stopPreviews();
  });
});
