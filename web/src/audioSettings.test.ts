import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getAudioSettings,
  setEffectsVolume,
  setMusicVolume,
  subscribeAudioSettings,
} from "./audioSettings";

const original = { ...getAudioSettings() };

afterEach(() => {
  setMusicVolume(original.music);
  setEffectsVolume(original.effects);
});

describe("audio settings", () => {
  it("clamps both volume controls", () => {
    setMusicVolume(2);
    setEffectsVolume(-1);
    expect(getAudioSettings()).toEqual({ music: 1, effects: 0 });
  });

  it("notifies listeners only when a value changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAudioSettings(listener);
    setMusicVolume(0.41);
    setMusicVolume(0.41);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
