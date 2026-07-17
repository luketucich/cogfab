import type { StatsMessage } from "../net/types";

// The latest economy numbers from the server: the authoritative credit total,
// the production rate, and where the upgrades stand, with the time they arrived
// so the credits counter can count up smoothly between the ~1/sec updates. Kept
// outside React like the world store; the counter reads it each animation
// frame.

// How fast material moves and how closely it packs, in belts and belts/sec.
// Mirror of materialSpeed and materialGap in internal/server/economy.go.
export const MATERIAL_SPEED = 2.5;
export const MATERIAL_GAP = 0.5;

// MAX_SIM_LEVEL is where the visuals stop getting busier: past this the belts
// are maxed on screen, and each visible chunk represents more raw units.
// Mirror of maxSimLevel in economy.go.
export const MAX_SIM_LEVEL = 5;

// Suffixes for big numbers, one per thousand step past a million.
const SUFFIXES = ["M", "B", "T", "Q"];

// fmtNum trims a number for display: whole numbers stay whole, fractions keep
// up to `decimals` digits, and big values get thousands separators. From a
// million up it switches to three-figure suffixes (1.25M, 30.2B), so an
// endgame purse reads at a glance instead of as a wall of digits.
export function fmtNum(n: number, decimals = 2): string {
  if (n >= 1_000_000) {
    let value = n / 1_000_000;
    let i = 0;
    while (value >= 1000 && i < SUFFIXES.length - 1) {
      value /= 1000;
      i++;
    }
    return (value >= 100 ? Math.round(value).toString() : value.toFixed(value >= 10 ? 1 : 2)) + SUFFIXES[i];
  }
  return Number(Number.isInteger(n) ? n : n.toFixed(decimals)).toLocaleString();
}

// beltMultiplier is the Belt Speed scale: each level adds a quarter of the base
// speed. Mirror of beltMult in economy.go.
export function beltMultiplier(beltLevel: number): number {
  return 1 + 0.25 * beltLevel;
}

// emissionMultiplier is the Extractor Rate scale: each level adds half the base
// emission rate. Mirror of extractorMult in economy.go.
export function emissionMultiplier(extractorLevel: number): number {
  return 1 + 0.5 * extractorLevel;
}

// saleMultiplier scales each resource's base value. Mirror of
// saleValueMultiplier in economy.go.
export function saleMultiplier(valueLevel: number): number {
  return 1 + valueLevel;
}

type Stats = {
  credits: number;
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
  credits: 0,
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

// Reservations are keyed by action so one server result cannot release a
// different build that is still in flight.
const reservations = new Map<number, number>();
let reserved = 0;

export function reserveSpend(actionId: number, cost: number): boolean {
  if (
    !Number.isSafeInteger(actionId) ||
    actionId <= 0 ||
    !Number.isSafeInteger(cost) ||
    cost < 0 ||
    cost > spendableCredits() ||
    reservations.has(actionId)
  ) {
    return false;
  }
  reservations.set(actionId, cost);
  reserved += cost;
  if (cost > 0) {
    stats = { ...stats };
    for (const fn of listeners) fn();
  }
  return true;
}

// settleSpend applies the authoritative balance and releases one reservation
// together, so the credits display cannot jump between consecutive messages.
export function settleSpend(actionId: number, credits: number): boolean {
  const cost = reservations.get(actionId);
  if (cost === undefined || !Number.isFinite(credits) || credits < 0) return false;
  reservations.delete(actionId);
  reserved -= cost;
  if (cost > 0 || credits !== stats.credits) {
    stats = { ...stats, credits, receivedAt: performance.now() };
    for (const fn of listeners) fn();
  }
  return true;
}

export function releaseSpend(actionId: number): boolean {
  const cost = reservations.get(actionId);
  if (cost === undefined) return false;
  reservations.delete(actionId);
  reserved -= cost;
  if (cost > 0) {
    stats = { ...stats };
    for (const fn of listeners) fn();
  }
  return true;
}

export function clearPendingSpend(): void {
  if (reservations.size === 0) return;
  reservations.clear();
  const changed = reserved > 0;
  reserved = 0;
  if (changed) {
    stats = { ...stats };
    for (const fn of listeners) fn();
  }
}

export function pendingSpendTotal(): number {
  return reserved;
}

// spendableCredits is the latest server total minus what is already in flight.
export function spendableCredits(): number {
  return Math.max(stats.credits - reserved, 0);
}

// creditsAfterReserve is the part of a balance that can be spent without
// touching credits held for a required purchase.
export function creditsAfterReserve(credits: number, reserve: number): number {
  return Math.max(credits - reserve, 0);
}

// setStats records a fresh economy update from the server.
export function setStats(msg: StatsMessage): void {
  stats = {
    credits: msg.credits,
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
  for (const fn of listeners) fn();
}

// getStats returns the latest economy numbers.
export function getStats(): Stats {
  return stats;
}

// subscribeStats notifies panels that show the rate, costs, and levels. The
// credits counter animates the total between updates.
export function subscribeStats(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
