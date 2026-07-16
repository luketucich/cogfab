export type AudioSettings = {
  music: number;
  effects: number;
};

// The v2 values are positions on a perceptual volume curve, not direct gain.
const STORAGE_KEY = "cogfab.audio.v2";
const DEFAULT_SETTINGS: AudioSettings = { music: 0.6, effects: 0.7 };
const listeners = new Set<() => void>();

function clamp(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function loadSettings(): AudioSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<AudioSettings> | null;
    return {
      music: clamp(typeof saved?.music === "number" ? saved.music : DEFAULT_SETTINGS.music),
      effects: clamp(typeof saved?.effects === "number" ? saved.effects : DEFAULT_SETTINGS.effects),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let current = loadSettings();

function update(next: AudioSettings): void {
  if (next.music === current.music && next.effects === current.effects) return;
  current = next;
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Audio still works when storage is unavailable.
  }
  for (const listener of listeners) listener();
}

export function getAudioSettings(): AudioSettings {
  return current;
}

export function setMusicVolume(value: number): void {
  update({ ...current, music: clamp(value) });
}

export function setEffectsVolume(value: number): void {
  update({ ...current, effects: clamp(value) });
}

export function subscribeAudioSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
