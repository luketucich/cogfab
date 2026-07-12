// Tiny synthesized sound effects. No audio files: each effect is a couple of
// oscillators or a noise burst shaped by a gain envelope, and everything runs
// through a lowpass so cues sound soft and physical instead of chiptune. The
// context starts on the first effect, which always happens inside a click or
// key press, so the browser's autoplay rules are satisfied.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

// ensure lazily creates the audio context and wakes it if the browser
// suspended it, returning null only when WebAudio is unavailable.
function ensure(): AudioContext | null {
  if (!ctx) {
    if (typeof AudioContext === "undefined") return null;
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.25; // lower the overall effect volume
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

// jitter varies an impact frequency by up to 2.5% so repeats are not identical.
function jitter(freq: number): number {
  return freq * (1 + (Math.random() - 0.5) * 0.05);
}

// tone plays one filtered oscillator with frequency and gain envelopes.
function tone(type: OscillatorType, from: number, to: number, delay: number, length: number, peak: number, cutoff = 2200) {
  const c = ensure();
  if (!c || !master) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t0 + length);
  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = cutoff;
  const gain = c.createGain();
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + length);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  osc.start(t0);
  osc.stop(t0 + length + 0.02);
}

// rumble plays a noise burst through a falling low-pass filter.
function rumble(cutoff: number, length: number, peak: number) {
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
  filter.frequency.setValueAtTime(cutoff, t0);
  filter.frequency.exponentialRampToValueAtTime(Math.max(cutoff / 4, 40), t0 + length);
  const gain = c.createGain();
  gain.gain.setValueAtTime(peak, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + length);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  src.start(t0);
}

// Rate-limit delivery sounds so a busy factory does not overwhelm other cues.
const DELIVER_GAP = 0.14;
let nextDeliverAt = 0;

// The game's sound board. Each is a short, distinct cue for one action.
export const sfx = {
  // Tool selection: a short high note.
  select(): void {
    tone("sine", 880, 620, 0, 0.05, 0.25, 1600);
  },
  // Placement: a low impact.
  place(): void {
    tone("sine", jitter(230), 120, 0, 0.1, 0.7, 900);
    rumble(700, 0.05, 0.18);
  },
  // Teardown: a noise burst and low tone.
  destroy(): void {
    rumble(600, 0.18, 0.55);
    tone("sine", jitter(150), 55, 0, 0.13, 0.35, 500);
  },
  // Rejected action: two muted notes.
  deny(): void {
    tone("sine", jitter(150), 110, 0, 0.06, 0.3, 600);
    tone("sine", jitter(135), 100, 0.08, 0.07, 0.25, 600);
  },
  // Upgrade purchase: a rising two-note cue.
  buy(): void {
    tone("sine", 523, 523, 0, 0.14, 0.4, 1500);
    tone("sine", 784, 784, 0.07, 0.2, 0.35, 1500);
  },
  // Land unlock: a larger three-note cue over a low root.
  expand(): void {
    tone("sine", 131, 131, 0, 0.5, 0.35, 700);
    tone("triangle", 523, 523, 0, 0.14, 0.3, 1400);
    tone("triangle", 659, 659, 0.09, 0.16, 0.3, 1400);
    tone("triangle", 784, 784, 0.18, 0.28, 0.3, 1400);
  },
  // Delivery: a rate-limited low impact. It runs outside an input event, so it
  // waits for another effect to start the audio context first.
  deliver(): void {
    if (!ctx || ctx.state !== "running" || ctx.currentTime < nextDeliverAt) return;
    nextDeliverAt = ctx.currentTime + DELIVER_GAP;
    tone("sine", jitter(115), 50, 0, 0.09, 0.28, 420);
    rumble(320, 0.04, 0.08);
  },
};
