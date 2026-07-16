import { getAudioSettings, subscribeAudioSettings } from "./audioSettings";

const TRACK_URL = "/audio/new-direction.mp3";

let player: HTMLAudioElement | null = null;
let unlocked = false;

function ensurePlayer(): HTMLAudioElement | null {
  if (player || typeof Audio === "undefined") return player;
  player = new Audio(TRACK_URL);
  player.loop = true;
  player.preload = "auto";
  return player;
}

function syncPlayer(): void {
  const audio = ensurePlayer();
  if (!audio) return;
  audio.volume = getAudioSettings().music;
  if (!unlocked) return;
  if (audio.volume === 0) {
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
