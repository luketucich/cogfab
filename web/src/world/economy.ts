import type { StatsMessage } from "../net/types";

// The latest economy numbers from the server: the authoritative iron-ore total,
// the production rate, and where the upgrades stand, with the time they arrived
// so the OreCounter can count up smoothly between the ~1/sec updates. Kept
// outside React like the world store; the OreCounter reads it each animation
// frame.

type Stats = {
  ironOre: number;
  ratePerSec: number;
  extractorLevel: number;
  extractorCost: number; // 0 = maxed
  gridWidth: number; // unlocked region, centred in the world
  gridHeight: number;
  gridCost: number; // 0 = maxed
  receivedAt: number;
};

let stats: Stats = {
  ironOre: 0,
  ratePerSec: 0,
  extractorLevel: 0,
  extractorCost: 0,
  gridWidth: 0,
  gridHeight: 0,
  gridCost: 0,
  receivedAt: 0,
};
const listeners = new Set<() => void>();

// pendingSpend is ore already committed to commands still in flight, so a fast
// belt drag cannot overspend against a total the server has not re-sent yet.
// Every stats update carries the true total, so it resets there.
let pendingSpend = 0;

export function addPendingSpend(cost: number): void {
  pendingSpend += cost;
}

// spendableOre is the latest server total minus what is already in flight.
export function spendableOre(): number {
  return stats.ironOre - pendingSpend;
}

// setStats records a fresh economy update from the server.
export function setStats(msg: StatsMessage): void {
  stats = {
    ironOre: msg.ironOre,
    ratePerSec: msg.ratePerSec,
    extractorLevel: msg.extractorLevel,
    extractorCost: msg.extractorCost,
    gridWidth: msg.gridWidth,
    gridHeight: msg.gridHeight,
    gridCost: msg.gridCost,
    receivedAt: performance.now(),
  };
  pendingSpend = 0;
  for (const fn of listeners) fn();
}

// getStats returns the latest economy numbers.
export function getStats(): Stats {
  return stats;
}

// subscribeStats notifies on each server update, for panels that show the
// rate, costs, and levels (the ore total counts up every frame instead, see
// OreCounter).
export function subscribeStats(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
