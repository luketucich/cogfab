import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StateMessage, StatsMessage } from "./types";
import { Connection } from "./connection";
import { clearPendingSpend, pendingSpendTotal, setStats, spendableCredits } from "../world/economy";
import { getLatest, resetLatest, setLatest } from "../world/store";
import { sfx } from "../sfx";

class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];

  readyState = FakeSocket.OPEN;
  sent: string[] = [];
  throwOnSend = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(payload: string): void {
    if (this.throwOnSend) throw new Error("socket closed");
    this.sent.push(payload);
  }

  close(): void {
    this.readyState = 3;
  }
}

const world = (): StateMessage => ({
  type: "state",
  width: 2,
  height: 1,
  tiles: [
    { kind: "empty", dir: "north" },
    { kind: "empty", dir: "north" },
  ],
  deposits: [],
  ports: [],
});

const stats = (credits = 500): StatsMessage => ({
  type: "stats",
  credits,
  ratePerSec: 0,
  extractorLevel: 0,
  extractorCost: 150,
  beltLevel: 0,
  beltCost: 200,
  valueLevel: 0,
  valueCost: 400,
  gridWidth: 8,
  gridHeight: 8,
  gridCost: 3000,
  nextGridWidth: 12,
  nextGridHeight: 12,
});

function connectedClient(protocol = 4): { connection: Connection; socket: FakeSocket } {
  const connection = new Connection();
  connection.start();
  const socket = FakeSocket.instances.at(-1)!;
  socket.onmessage?.({ data: JSON.stringify({ type: "welcome", room: "PREDICT", slot: 0, protocol }) });
  setLatest(world());
  setStats(stats());
  return { connection, socket };
}

describe("predicted world actions", () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal("location", { protocol: "http:", host: "localhost:5173", search: "", pathname: "/" });
    vi.stubGlobal("history", { replaceState: vi.fn() });
  });

  afterEach(() => {
    resetLatest();
    clearPendingSpend();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders immediately and attaches monotonic action IDs", () => {
    const { connection, socket } = connectedClient();

    expect(
      connection.sendAction(
        { type: "placeBatch", kind: "belt", placements: [{ x: 0, y: 0, dir: "east" }] },
        [{ x: 0, y: 0, kind: "belt", dir: "east" }],
        10,
      ),
    ).toEqual({ predicted: true });
    expect(getLatest()?.tiles[0]).toEqual({ kind: "belt", dir: "east" });

    expect(
      connection.sendAction(
        { type: "rotate", x: 0, y: 0, expectedKind: "belt", expectedDir: "east" },
        [{ x: 0, y: 0, kind: "belt", dir: "south" }],
      ),
    ).toEqual({ predicted: true });
    expect(getLatest()?.tiles[0]).toEqual({ kind: "belt", dir: "south" });

    expect(socket.sent.map((payload) => JSON.parse(payload).actionId)).toEqual([1, 2]);
    expect(pendingSpendTotal()).toBe(10);
  });

  it("rolls back a prediction when the browser cannot send it", () => {
    const { connection, socket } = connectedClient();
    socket.throwOnSend = true;

    const result = connection.sendAction(
      { type: "placeBatch", kind: "belt", placements: [{ x: 0, y: 0, dir: "east" }] },
      [{ x: 0, y: 0, kind: "belt", dir: "east" }],
      10,
    );

    expect(result).toBeNull();
    expect(getLatest()?.tiles[0]).toEqual({ kind: "empty", dir: "north" });
    expect(pendingSpendTotal()).toBe(0);
  });

  it("falls back safely when an older server does not advertise prediction", () => {
    const { connection, socket } = connectedClient(3);

    expect(
      connection.sendAction(
        { type: "placeBatch", kind: "belt", placements: [{ x: 0, y: 0, dir: "east" }] },
        [{ x: 0, y: 0, kind: "belt", dir: "east" }],
        10,
      ),
    ).toEqual({ predicted: false });

    expect(getLatest()?.tiles[0]).toEqual({ kind: "empty", dir: "north" });
    expect(JSON.parse(socket.sent[0])).not.toHaveProperty("actionId");
    expect(pendingSpendTotal()).toBe(10);
    expect(
      connection.sendAction(
        { type: "placeBatch", kind: "belt", placements: [{ x: 0, y: 0, dir: "east" }] },
        [{ x: 0, y: 0, kind: "belt", dir: "east" }],
        10,
      ),
    ).toBeNull();

    socket.onmessage?.({ data: JSON.stringify(stats()) });
    expect(pendingSpendTotal()).toBe(0);
  });

  it("clears predictions and reservations when the socket closes", () => {
    const { connection, socket } = connectedClient();
    connection.sendAction(
      { type: "placeBatch", kind: "belt", placements: [{ x: 0, y: 0, dir: "east" }] },
      [{ x: 0, y: 0, kind: "belt", dir: "east" }],
      10,
    );

    socket.onclose?.();

    expect(getLatest()?.tiles[0]).toEqual({ kind: "empty", dir: "north" });
    expect(pendingSpendTotal()).toBe(0);

    vi.advanceTimersByTime(500);
    const reconnected = FakeSocket.instances.at(-1)!;
    expect(reconnected).not.toBe(socket);
    expect(reconnected.sent).toEqual([]);

    reconnected.onmessage?.({ data: JSON.stringify({ type: "welcome", room: "PREDICT", slot: 0, protocol: 4 }) });
    setLatest(world());
    setStats(stats());
    expect(
      connection.sendAction(
        { type: "placeBatch", kind: "belt", placements: [{ x: 1, y: 0, dir: "east" }] },
        [{ x: 1, y: 0, kind: "belt", dir: "east" }],
        10,
      ),
    ).toEqual({ predicted: true });
    expect(JSON.parse(reconnected.sent[0]).actionId).toBe(2);
  });

  it("settles rapid accepted and rejected actions independently", () => {
    const deny = vi.spyOn(sfx, "deny").mockImplementation(() => undefined);
    const { connection, socket } = connectedClient();

    connection.sendAction(
      { type: "placeBatch", kind: "belt", placements: [{ x: 0, y: 0, dir: "east" }] },
      [{ x: 0, y: 0, kind: "belt", dir: "east" }],
      10,
    );
    connection.sendAction(
      { type: "placeBatch", kind: "extractor", placements: [{ x: 1, y: 0, dir: "south" }] },
      [{ x: 1, y: 0, kind: "extractor", dir: "south" }],
      75,
    );
    expect(pendingSpendTotal()).toBe(85);

    socket.onmessage?.({
      data: JSON.stringify({ type: "tiles", tiles: [{ x: 0, y: 0, kind: "belt", dir: "east" }] }),
    });
    socket.onmessage?.({ data: JSON.stringify({ type: "actionResult", actionId: 1, applied: true, credits: 490 }) });
    socket.onmessage?.({ data: JSON.stringify(stats(490)) });
    socket.onmessage?.({ data: JSON.stringify({ type: "actionResult", actionId: 2, applied: false, credits: 490 }) });
    socket.onmessage?.({ data: JSON.stringify(stats(490)) });

    expect(getLatest()?.tiles).toEqual([
      { kind: "belt", dir: "east" },
      { kind: "empty", dir: "north" },
    ]);
    expect(pendingSpendTotal()).toBe(0);
    expect(spendableCredits()).toBe(490);
    expect(deny).toHaveBeenCalledOnce();
  });
});
