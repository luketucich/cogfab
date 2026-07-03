// Tiny synthesized sound effects. No audio files: each effect is a couple of
// oscillators or a noise burst shaped by a gain envelope. The context starts on
// the first effect, which always happens inside a click or key press, so the
// browser's autoplay rules are satisfied.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

// ensure lazily creates the audio context and wakes it if the browser
// suspended it, returning null only when WebAudio is unavailable.
function ensure(): AudioContext | null {
  if (!ctx) {
    if (typeof AudioContext === "undefined") return null;
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.25; // keep everything gentle
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

// tone plays one note: a frequency glide with a fast attack and a smooth decay.
function tone(type: OscillatorType, from: number, to: number, delay: number, length: number, peak: number) {
  const c = ensure();
  if (!c || !master) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t0 + length);
  const gain = c.createGain();
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + length);
  osc.connect(gain);
  gain.connect(master);
  osc.start(t0);
  osc.stop(t0 + length + 0.02);
}

// thud plays a burst of noise through a lowpass, for knocks and breaks.
function thud(cutoff: number, length: number, peak: number) {
  const c = ensure();
  if (!c || !master) return;
  const t0 = c.currentTime;
  const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * length), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = cutoff;
  const gain = c.createGain();
  gain.gain.setValueAtTime(peak, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + length);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  src.start(t0);
}

// The game's sound board. Each is a short, distinct cue for one action.
export const sfx = {
  // picking a tool: a quick soft blip
  select(): void {
    tone("square", 700, 700, 0, 0.05, 0.18);
  },
  // placing a structure: a satisfying low thock
  place(): void {
    tone("sine", 280, 150, 0, 0.09, 0.8);
    thud(1400, 0.04, 0.2);
  },
  // tearing one down: a crumbly break
  destroy(): void {
    thud(900, 0.15, 0.7);
    tone("sine", 160, 60, 0, 0.12, 0.35);
  },
  // clicking somewhere you cannot build: a dull knock
  deny(): void {
    tone("square", 110, 90, 0, 0.09, 0.3);
  },
  // buying an upgrade: a rising two-note chime
  buy(): void {
    tone("triangle", 523, 523, 0, 0.1, 0.5);
    tone("triangle", 784, 784, 0.08, 0.16, 0.5);
  },
  // unlocking land: a bigger three-note arpeggio over a low root
  expand(): void {
    tone("sine", 131, 131, 0, 0.5, 0.4);
    tone("triangle", 523, 523, 0, 0.14, 0.45);
    tone("triangle", 659, 659, 0.09, 0.16, 0.45);
    tone("triangle", 784, 784, 0.18, 0.28, 0.45);
  },
};
