import { getAudioSettings, subscribeAudioSettings } from "./audioSettings";

export const MUSIC_MAX_DECIBELS = -10;
export const EFFECTS_MAX_DECIBELS = -6;

const MASTER_DECIBELS = -1;
const LEVEL_RAMP_SECONDS = 0.025;

export type AudioMixer = {
  context: AudioContext;
  music: GainNode;
  effects: GainNode;
};

let mixer: AudioMixer | null = null;

export function decibelsToGain(decibels: number): number {
  return 10 ** (decibels / 20);
}

// A squared curve gives the sliders a useful, natural-feeling lower range.
export function sliderToGain(value: number, maxDecibels: number): number {
  const position = Math.min(Math.max(value, 0), 1);
  return position ** 2 * decibelsToGain(maxDecibels);
}

function setLevel(parameter: AudioParam, value: number, context: AudioContext): void {
  const now = context.currentTime;
  parameter.cancelScheduledValues(now);
  parameter.setTargetAtTime(value, now, LEVEL_RAMP_SECONDS);
}

function syncLevels(): void {
  if (!mixer) return;
  const settings = getAudioSettings();
  setLevel(mixer.music.gain, sliderToGain(settings.music, MUSIC_MAX_DECIBELS), mixer.context);
  setLevel(mixer.effects.gain, sliderToGain(settings.effects, EFFECTS_MAX_DECIBELS), mixer.context);
}

subscribeAudioSettings(syncLevels);

export function ensureAudioMixer(): AudioMixer | null {
  if (!mixer) {
    if (typeof AudioContext === "undefined") return null;

    const context = new AudioContext();
    const music = context.createGain();
    const effects = context.createGain();
    const compressor = context.createDynamicsCompressor();
    const master = context.createGain();
    const settings = getAudioSettings();

    music.gain.value = sliderToGain(settings.music, MUSIC_MAX_DECIBELS);
    effects.gain.value = sliderToGain(settings.effects, EFFECTS_MAX_DECIBELS);

    compressor.threshold.value = -12;
    compressor.knee.value = 8;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.16;
    master.gain.value = decibelsToGain(MASTER_DECIBELS);

    music.connect(compressor);
    effects.connect(compressor);
    compressor.connect(master);
    master.connect(context.destination);

    mixer = { context, music, effects };
  }

  if (mixer.context.state === "suspended") void mixer.context.resume();
  return mixer;
}

export function getActiveAudioMixer(): AudioMixer | null {
  return mixer;
}
