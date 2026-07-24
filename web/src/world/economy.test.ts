import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StatsMessage } from "../net/types";
import {
  BASE_REFINE_TIME,
  clearPendingSpend,
  creditsAfterReserve,
  fmtNum,
  getStats,
  pendingSpendTotal,
  releaseSpend,
  refinerAt,
  refinerProgress,
  refinerRemaining,
  refineTime,
  reserveSpend,
  setStats,
  settleSpend,
  spendableCredits,
  subscribeStats,
  visualBatchSize,
} from "./economy";

function stats(credits: number): StatsMessage {
  return {
    type: "stats",
    credits,
    ratePerSec: 0,
    extractorLevel: 0,
    extractorCost: 150,
    beltLevel: 0,
    beltCost: 200,
    valueLevel: 0,
    valueCost: 400,
    refinerLevel: 0,
    refinerCost: 250,
    gridWidth: 8,
    gridHeight: 8,
    gridCost: 300,
    nextGridWidth: 12,
    nextGridHeight: 12,
  };
}

beforeEach(() => {
  clearPendingSpend();
  setStats(stats(250));
});

describe("fmtNum", () => {
  it("keeps small numbers exact, with separators", () => {
    expect(fmtNum(0)).toBe("0");
    expect(fmtNum(7.5)).toBe("7.5");
    expect(fmtNum(999_999)).toBe("999,999");
  });

  it("switches to three-figure suffixes from a million up", () => {
    expect(fmtNum(1_250_000)).toBe("1.25M");
    expect(fmtNum(12_500_000)).toBe("12.5M");
    expect(fmtNum(125_000_000)).toBe("125M");
    expect(fmtNum(30_200_000_000)).toBe("30.2B");
    expect(fmtNum(4_000_000_000_000)).toBe("4.00T");
  });

  it("stays on the last suffix rather than inventing one", () => {
    expect(fmtNum(9_100_000_000_000_000)).toBe("9.10Q");
    expect(fmtNum(2e21)).toBe("2000000Q");
  });
});

describe("creditsAfterReserve", () => {
  it("keeps a required balance out of the spendable budget", () => {
    expect(creditsAfterReserve(900, 500)).toBe(400);
    expect(creditsAfterReserve(300, 500)).toBe(0);
    expect(creditsAfterReserve(300, 0)).toBe(300);
  });
});

describe("refiner balance", () => {
  it("mirrors the server processing curve", () => {
    expect(BASE_REFINE_TIME).toBe(0.4);
    expect(refineTime(0)).toBe(0.4);
    expect(refineTime(1)).toBeCloseTo(0.4 / 1.5);
    expect(refineTime(2)).toBe(0.2);
  });

  it("scales visible processing batches without changing physical capacity", () => {
    expect(visualBatchSize(5, 5)).toBe(1);
    expect(visualBatchSize(12, 12)).toBeCloseTo(
      ((1 + 0.5 * 12) / (1 + 0.5 * 5)) * ((1 + 0.25 * 12) / (1 + 0.25 * 5)),
    );
  });
});

describe("refiner status", () => {
  it("keeps older-server stats compatible", () => {
    expect(getStats().refiners).toEqual([]);
    expect(refinerAt(2, 3)).toBeUndefined();
  });

  it("interpolates progress between authoritative snapshots", () => {
    setStats({
      ...stats(250),
      refiners: [{ x: 2, y: 3, resource: "copper", remaining: 1.5, duration: 2, queued: 4 }],
    });
    const refiner = refinerAt(2, 3)!;
    const halfSecondLater = getStats().receivedAt + 500;

    expect(refinerRemaining(refiner, halfSecondLater)).toBeCloseTo(1);
    expect(refinerProgress(refiner, halfSecondLater)).toBeCloseTo(0.5);
    expect(refiner.queued).toBe(4);
  });

  it("shows no countdown while idle", () => {
    setStats({ ...stats(250), refiners: [{ x: 1, y: 1, remaining: 0, duration: 2, queued: 0 }] });
    const refiner = refinerAt(1, 1)!;

    expect(refinerRemaining(refiner, getStats().receivedAt + 10_000)).toBe(0);
    expect(refinerProgress(refiner, getStats().receivedAt + 10_000)).toBe(0);
  });

  it("uses the authoritative inbound ETA before settling into output cadence", () => {
    setStats({
      ...stats(250),
      refiners: [{ x: 1, y: 1, remaining: 0, duration: 0.5, nextOutput: 1.5, queued: 0, incoming: 4 }],
    });
    const refiner = refinerAt(1, 1)!;
    const receivedAt = getStats().receivedAt;

    expect(refinerRemaining(refiner, receivedAt + 100)).toBeCloseTo(1.4);
    expect(refinerProgress(refiner, receivedAt + 100)).toBeCloseTo(1 / 15);
    expect(refinerRemaining(refiner, receivedAt + 1_600)).toBe(0);
    expect(refinerProgress(refiner, receivedAt + 1_600)).toBe(1);
  });

  it("cycles only through ore that is actually waiting at the machine", () => {
    setStats({
      ...stats(250),
      refiners: [{ x: 1, y: 1, remaining: 0, duration: 0.5, nextOutput: 1.5, queued: 4, incoming: 2 }],
    });
    const refiner = refinerAt(1, 1)!;
    const receivedAt = getStats().receivedAt;

    expect(refinerRemaining(refiner, receivedAt + 1_600)).toBeCloseTo(0.4);
    expect(refinerProgress(refiner, receivedAt + 1_600)).toBeCloseTo(0.2);
    expect(refinerRemaining(refiner, receivedAt + 3_100)).toBe(0);
    expect(refinerProgress(refiner, receivedAt + 3_100)).toBe(1);
  });

  it("does not invent an ETA from an inbound count alone", () => {
    setStats({
      ...stats(250),
      refiners: [{ x: 1, y: 1, remaining: 0, duration: 0.5, queued: 0, incoming: 4 }],
    });
    const refiner = refinerAt(1, 1)!;

    expect(refinerRemaining(refiner, getStats().receivedAt + 100)).toBe(0);
    expect(refinerProgress(refiner, getStats().receivedAt + 100)).toBe(0);
  });

  it("does not schedule distant inbound ore behind an active job", () => {
    setStats({
      ...stats(250),
      refiners: [
        { x: 1, y: 1, resource: "iron", remaining: 0.25, duration: 0.5, queued: 0, incoming: 4 },
      ],
    });
    const refiner = refinerAt(1, 1)!;
    const afterActiveJob = getStats().receivedAt + 300;

    expect(refinerRemaining(refiner, afterActiveJob)).toBe(0);
    expect(refinerProgress(refiner, afterActiveJob)).toBe(1);
  });

  it("keeps cycling between coarse snapshots while work is queued", () => {
    setStats({
      ...stats(250),
      refiners: [{ x: 1, y: 1, resource: "iron", remaining: 0.25, duration: 0.5, queued: 3 }],
    });
    const refiner = refinerAt(1, 1)!;
    const receivedAt = getStats().receivedAt;

    expect(refinerProgress(refiner, receivedAt + 100)).toBeCloseTo(0.7);
    expect(refinerRemaining(refiner, receivedAt + 300)).toBeCloseTo(0.45);
    expect(refinerProgress(refiner, receivedAt + 300)).toBeCloseTo(0.1);
    expect(refinerRemaining(refiner, receivedAt + 1_800)).toBe(0);
    expect(refinerProgress(refiner, receivedAt + 1_800)).toBe(1);
  });
});

describe("pending spend", () => {
  it("reserves credits independently by action", () => {
    const before = getStats();
    expect(reserveSpend(1, 75)).toBe(true);
    expect(reserveSpend(2, 30)).toBe(true);

    expect(pendingSpendTotal()).toBe(105);
    expect(getStats()).not.toBe(before);
    expect(spendableCredits()).toBe(145);
    expect(reserveSpend(1, 10)).toBe(false);
    expect(reserveSpend(3, 200)).toBe(false);
    expect(pendingSpendTotal()).toBe(105);
  });

  it("tracks zero-cost actions so their results can update credits", () => {
    const listener = vi.fn();
    const off = subscribeStats(listener);
    expect(reserveSpend(1, 0)).toBe(true);
    expect(listener).not.toHaveBeenCalled();
    expect(settleSpend(1, 300)).toBe(true);
    expect(spendableCredits()).toBe(300);
    expect(listener).toHaveBeenCalledOnce();
    expect(reserveSpend(2, 0)).toBe(true);
    expect(settleSpend(2, 300)).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
    off();
  });

  it("keeps reservations through interleaved stats updates", () => {
    reserveSpend(1, 75);
    reserveSpend(2, 30);

    setStats(stats(200));

    expect(pendingSpendTotal()).toBe(105);
    expect(spendableCredits()).toBe(95);
  });

  it("settles one action with the authoritative balance", () => {
    reserveSpend(1, 75);
    reserveSpend(2, 30);
    const listener = vi.fn();
    const off = subscribeStats(listener);

    expect(settleSpend(1, 175)).toBe(true);

    expect(listener).toHaveBeenCalledOnce();
    expect(pendingSpendTotal()).toBe(30);
    expect(spendableCredits()).toBe(145);
    expect(settleSpend(99, 0)).toBe(false);
    expect(listener).toHaveBeenCalledOnce();
    off();
  });

  it("does not strand a reservation at a large server balance", () => {
    reserveSpend(1, 75);

    expect(settleSpend(1, Number.MAX_SAFE_INTEGER + 1_000)).toBe(true);
    expect(pendingSpendTotal()).toBe(0);
  });

  it("releases one reservation without changing the confirmed balance", () => {
    reserveSpend(1, 75);
    reserveSpend(2, 30);

    expect(releaseSpend(1)).toBe(true);

    expect(pendingSpendTotal()).toBe(30);
    expect(spendableCredits()).toBe(220);
    expect(releaseSpend(1)).toBe(false);
  });

  it("clears all reservations with one notification", () => {
    reserveSpend(1, 75);
    reserveSpend(2, 30);
    const listener = vi.fn();
    const off = subscribeStats(listener);

    clearPendingSpend();

    expect(listener).toHaveBeenCalledOnce();
    expect(pendingSpendTotal()).toBe(0);
    expect(spendableCredits()).toBe(250);
    clearPendingSpend();
    expect(listener).toHaveBeenCalledOnce();
    off();
  });

  it("rejects invalid reservations without notifying", () => {
    const listener = vi.fn();
    const off = subscribeStats(listener);

    expect(reserveSpend(0, 10)).toBe(false);
    expect(reserveSpend(1, -1)).toBe(false);
    expect(reserveSpend(1, 1.5)).toBe(false);
    expect(reserveSpend(1, Number.NaN)).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    off();
  });
});
