import type { RefinerStatus, StatsMessage } from "../net/types";

// The latest economy numbers from the server: the authoritative credit total,
// the production rate, and where the upgrades stand, with the time they arrived
// so the credits counter can count up smoothly between the ~1/sec updates. Kept
// outside React like the world store; the counter reads it each animation
// frame.

// How fast material moves and how closely it packs, in belts and belts/sec.
// Mirror of materialSpeed and materialGap in internal/server/economy.go.
export const MATERIAL_SPEED = 2.5;
export const MATERIAL_GAP = 0.5;

// BASE_REFINE_TIME is how long a level-0 refiner holds one job, in seconds.
// This lets a new refiner process half of an untouched 5 ore/s line, making
// the 3x product value a 1.5x cash-flow gain. Mirror of baseRefineTime in
// economy.go.
export const BASE_REFINE_TIME = 0.4;

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

// refineMultiplier is the Refiner Speed scale. Mirror of refineMult in economy.go.
export function refineMultiplier(refinerLevel: number): number {
  return 1 + 0.5 * refinerLevel;
}

// refineTime is how long one refiner job takes. Mirror of refineTime in economy.go.
export function refineTime(refinerLevel: number): number {
  return BASE_REFINE_TIME / refineMultiplier(refinerLevel);
}

// visualBatchSize is how many physical ore units one rendered chunk represents
// beyond the simulation cap. Refiners multiply their visible processing time by
// the same amount so batching never creates free capacity.
export function visualBatchSize(extractorLevel: number, beltLevel: number): number {
  let units = 1;
  if (extractorLevel > MAX_SIM_LEVEL) {
    units *= emissionMultiplier(extractorLevel) / emissionMultiplier(MAX_SIM_LEVEL);
  }
  if (beltLevel > MAX_SIM_LEVEL) {
    units *= beltMultiplier(beltLevel) / beltMultiplier(MAX_SIM_LEVEL);
  }
  return units;
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
  refinerLevel: number;
  refinerCost: number; // 0 = maxed
  gridWidth: number; // unlocked region, centred in the world
  gridHeight: number;
  gridCost: number; // 0 = maxed
  nextGridWidth: number; // 0 when maxed
  nextGridHeight: number;
  refiners: readonly RefinerStatus[];
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
  refinerLevel: 0,
  refinerCost: 0,
  gridWidth: 0,
  gridHeight: 0,
  gridCost: 0,
  nextGridWidth: 0,
  nextGridHeight: 0,
  refiners: [],
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
    refinerLevel: msg.refinerLevel ?? 0,
    refinerCost: msg.refinerCost ?? 0,
    gridWidth: msg.gridWidth,
    gridHeight: msg.gridHeight,
    gridCost: msg.gridCost,
    nextGridWidth: msg.nextGridWidth,
    nextGridHeight: msg.nextGridHeight,
    refiners: msg.refiners ?? [],
    receivedAt: performance.now(),
  };
  for (const fn of listeners) fn();
}

// getStats returns the latest economy numbers.
export function getStats(): Stats {
  return stats;
}

export function refinerAt(x: number, y: number): RefinerStatus | undefined {
  return stats.refiners.find((refiner) => refiner.x === x && refiner.y === y);
}

function pendingRefinerJobs(refiner: RefinerStatus): number {
  return refiner.queued + (refiner.incoming ?? 0);
}

function elapsedSinceStats(now: number): number {
  return stats.receivedAt ? Math.max(now - stats.receivedAt, 0) / 1000 : 0;
}

function remainingAcrossJobs(first: number, laterJobs: number, duration: number, elapsed: number): number {
  if (elapsed < first) return first - elapsed;
  const laterElapsed = elapsed - first;
  if (laterJobs <= 0 || laterElapsed >= laterJobs * duration) return 0;
  return duration - (laterElapsed % duration);
}

// refinerRemaining interpolates between the server's one-second snapshots.
// Each fresh snapshot replaces this estimate, so the server remains the source
// of truth while the progress display moves smoothly.
export function refinerRemaining(refiner: RefinerStatus, now = performance.now()): number {
  if (refiner.duration <= 0) return 0;
  const pending = pendingRefinerJobs(refiner);
  const elapsed = elapsedSinceStats(now);
  if (refiner.resource) {
    return remainingAcrossJobs(refiner.remaining, refiner.queued, refiner.duration, elapsed);
  }
  const nextOutput = refiner.nextOutput ?? 0;
  if (nextOutput <= 0 || pending <= 0) return 0;
  return remainingAcrossJobs(nextOutput, Math.max(refiner.queued - 1, 0), refiner.duration, elapsed);
}

export function refinerProgress(refiner: RefinerStatus, now = performance.now()): number {
  if (refiner.duration <= 0) return 0;
  const pending = pendingRefinerJobs(refiner);
  const elapsed = elapsedSinceStats(now);
  const first = refiner.resource ? refiner.remaining : (refiner.nextOutput ?? 0);
  if (first <= 0 || (!refiner.resource && pending <= 0)) return 0;
  if (elapsed < first) {
    const window = refiner.resource ? refiner.duration : first;
    return Math.min(Math.max(1 - (first - elapsed) / window, 0), 1);
  }
  const laterJobs = refiner.resource ? refiner.queued : Math.max(refiner.queued - 1, 0);
  const laterElapsed = elapsed - first;
  if (laterJobs <= 0 || laterElapsed >= laterJobs * refiner.duration) return 1;
  return (laterElapsed % refiner.duration) / refiner.duration;
}

// subscribeStats notifies panels that show the rate, costs, and levels. The
// credits counter animates the total between updates.
export function subscribeStats(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
