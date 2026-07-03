import type { StatsMessage } from "../net/types";

// The latest economy numbers from the server: the authoritative iron-ore total,
// the production rate, and where the upgrades stand, with the time they arrived
// so the OreCounter can count up smoothly between the ~1/sec updates. Kept
// outside React like the world store; the OreCounter reads it each animation
// frame.

// How fast ore moves and how closely it packs, in belts and belts/sec. Mirror
// of oreSpeed and oreGap in internal/server/economy.go; keep them in step.
export const ORE_SPEED = 2.5;
export const ORE_GAP = 0.5;

// fmtNum trims a number for display: whole numbers stay whole, fractions keep
// up to `decimals` digits with trailing zeros dropped.
export function fmtNum(n: number, decimals = 2): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(decimals)));
}

// beltMultiplier is the Belt Speed scale: each level adds a quarter of the base
// speed. Mirror of beltSpeed in economy.go.
export function beltMultiplier(beltLevel: number): number {
  return 1 + 0.25 * beltLevel;
}

// perExtractorRate is the ore per second one extractor earns at the given
// upgrade levels: denser emission, faster belts, and a value multiplier on
// each delivery. Mirror of emitGap, beltSpeed, and oreValue in economy.go,
// expressed as one rate for the upgrade cards.
export function perExtractorRate(extractorLevel: number, beltLevel: number, valueLevel: number): number {
  const chunksPerSec = (ORE_SPEED * beltMultiplier(beltLevel)) / (ORE_GAP / (1 + 0.5 * extractorLevel));
  return chunksPerSec * (1 + valueLevel);
}

type Stats = {
  ironOre: number;
  ratePerSec: number;
  extractorLevel: number;
  extractorCost: number; // 0 = maxed
  beltLevel: number;
  beltCost: number; // 0 = maxed
  valueLevel: number;
  valueCost: number; // 0 = maxed
  gridWidth: number; // unlocked region, centred in the world
  gridHeight: number;
  gridCost: number; // 0 = maxed
  nextGridWidth: number; // 0 when maxed
  nextGridHeight: number;
  receivedAt: number;
};

let stats: Stats = {
  ironOre: 0,
  ratePerSec: 0,
  extractorLevel: 0,
  extractorCost: 0,
  beltLevel: 0,
  beltCost: 0,
  valueLevel: 0,
  valueCost: 0,
  gridWidth: 0,
  gridHeight: 0,
  gridCost: 0,
  nextGridWidth: 0,
  nextGridHeight: 0,
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
    beltLevel: msg.beltLevel,
    beltCost: msg.beltCost,
    valueLevel: msg.valueLevel,
    valueCost: msg.valueCost,
    gridWidth: msg.gridWidth,
    gridHeight: msg.gridHeight,
    gridCost: msg.gridCost,
    nextGridWidth: msg.nextGridWidth,
    nextGridHeight: msg.nextGridHeight,
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
