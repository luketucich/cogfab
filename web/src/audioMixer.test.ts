import { describe, expect, it } from "vitest";
import {
  decibelsToGain,
  EFFECTS_MAX_DECIBELS,
  MUSIC_MAX_DECIBELS,
  sliderToGain,
} from "./audioMixer";

describe("audio mixer levels", () => {
  it("converts decibels to linear gain", () => {
    expect(decibelsToGain(0)).toBe(1);
    expect(decibelsToGain(-6)).toBeCloseTo(0.501, 3);
  });

  it("uses a perceptual slider curve with a true mute", () => {
    expect(sliderToGain(0, EFFECTS_MAX_DECIBELS)).toBe(0);
    expect(sliderToGain(0.5, EFFECTS_MAX_DECIBELS)).toBeCloseTo(0.125, 3);
  });

  it("keeps the music bus below the effects bus", () => {
    expect(sliderToGain(1, MUSIC_MAX_DECIBELS)).toBeCloseTo(0.316, 3);
    expect(sliderToGain(1, MUSIC_MAX_DECIBELS)).toBeLessThan(sliderToGain(1, EFFECTS_MAX_DECIBELS));
  });
});
