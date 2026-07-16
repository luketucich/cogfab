import { getAudioSettings, subscribeAudioSettings } from "./audioSettings";
import { ensureAudioMixer, MUSIC_MAX_DECIBELS, sliderToGain } from "./audioMixer";

const TRACK_URL = "/audio/new-direction.mp3";

let player: HTMLAudioElement | null = null;
let source: MediaElementAudioSourceNode | null = null;
let unlocked = false;

function ensurePlayer(): HTMLAudioElement | null {
  if (player || typeof Audio === "undefined") return player;
  player = new Audio(TRACK_URL);
  player.loop = true;
  player.preload = "metadata"; // the full track can wait for the first interaction
  return player;
}

function syncPlayer(): void {
  const audio = ensurePlayer();
  if (!audio) return;

  const mixer = unlocked ? ensureAudioMixer() : null;
  if (mixer && !source) {
    source = mixer.context.createMediaElementSource(audio);
    source.connect(mixer.music);
  }

  // Keep a safe fallback for browsers without Web Audio support.
  audio.volume = mixer ? 1 : sliderToGain(getAudioSettings().music, MUSIC_MAX_DECIBELS);
  if (!unlocked) return;
  if (getAudioSettings().music === 0) {
    audio.pause();
  } else if (audio.paused) {
    void audio.play().catch(() => {});
  }
}

subscribeAudioSettings(syncPlayer);

// Browsers allow music only after the player interacts with the page.
export function startBackgroundMusic(): void {
  unlocked = true;
  syncPlayer();
}
