// The latest economy numbers from the server: the authoritative iron-ore total
// and the current production rate, with the time they arrived so the HUD can
// count up smoothly between the ~1/sec updates. Kept outside React like the
// world store; the OreCounter reads it each animation frame.

type Stats = { ironOre: number; ratePerSec: number; receivedAt: number };

let stats: Stats = { ironOre: 0, ratePerSec: 0, receivedAt: 0 };
const listeners = new Set<() => void>();

// setStats records a fresh economy update from the server.
export function setStats(ironOre: number, ratePerSec: number): void {
  stats = { ironOre, ratePerSec, receivedAt: performance.now() };
  for (const fn of listeners) fn();
}

// getStats returns the latest economy numbers.
export function getStats(): Stats {
  return stats;
}

// subscribeStats notifies on each server update, for panels that just show the
// rate (the ore total counts up every frame instead, see OreCounter).
export function subscribeStats(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
