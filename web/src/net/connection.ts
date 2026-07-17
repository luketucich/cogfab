import type { Command, ServerMessage, TileUpdate, WorldActionCommand } from "./types";
import { applyTiles, clearPredictions, predictAction, resetLatest, resolveAction, setLatest, setResources } from "../world/store";
import { clearPendingSpend, releaseSpend, reserveSpend, setStats, settleSpend } from "../world/economy";
import { setCursor, setPresence, setPresencePreview } from "../world/presence";
import { setRoomFull, setSession } from "./session";
import { setPing } from "./ping";
import { sfx } from "../sfx";

const PING_INTERVAL = 2000; // ms between round-trip probes
const WIRE_PROTOCOL = "4";
const PREDICTED_ACTION_PROTOCOL = 4;

// wsUrl is where the game server lives: derived from the page in production,
// a localhost fallback in dev (Vite serves the page, Go serves the game). The
// room code rides along from the address bar, and because location is read
// fresh on every attempt, reconnects follow whatever room the URL names.
export function wsUrl(loc: Pick<Location, "protocol" | "host" | "search"> = location, dev = import.meta.env.DEV): string {
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  const host = dev ? "localhost:8080" : loc.host;
  const room = new URLSearchParams(loc.search).get("room");
  const params = new URLSearchParams();
  if (room) params.set("room", room);
  params.set("protocol", WIRE_PROTOCOL);
  return `${proto}//${host}/ws?${params}`;
}

export function handleServerMessage(msg: ServerMessage): void {
  if (msg.type === "state") setLatest(msg);
  else if (msg.type === "tiles") applyTiles(msg);
  else if (msg.type === "stats") setStats(msg);
  else if (msg.type === "resources") setResources(msg);
  else if (msg.type === "actionResult") {
    const hadPrediction = resolveAction(msg.actionId);
    const hadReservation = settleSpend(msg.actionId, msg.credits);
    if (!msg.applied && (hadPrediction || hadReservation)) sfx.deny();
  } else if (msg.type === "welcome") {
    resetLatest();
    clearPendingSpend();
    setSession(msg.room, msg.slot);
    // The server's code is authoritative: write it into the address bar so
    // the URL is the invite link and a reconnect rejoins the same room.
    history.replaceState(null, "", `${location.pathname}?room=${msg.room}`);
  } else if (msg.type === "presence") setPresence(msg.players);
  else if (msg.type === "cursor") setCursor(msg);
  else if (msg.type === "buildPreview") setPresencePreview(msg);
  else if (msg.type === "roomFull") setRoomFull();
  else if (msg.type === "pong") setPing(performance.now() - msg.t);
}

type StatusListener = (connected: boolean) => void;

export type SentAction = { predicted: boolean };

// Connection owns the single WebSocket to the game server. It lives outside
// React so it survives component re-mounts, decodes incoming snapshots into the
// world store, and reconnects with backoff if the socket drops.
export class Connection {
  private ws: WebSocket | null = null;
  private backoff = 500; // ms; doubles on each failed attempt, capped
  private listeners = new Set<StatusListener>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private refused = false; // the room was full; reconnecting would just knock again
  private nextActionId = 1;
  private serverProtocol = 0;
  private legacySpendPending = false;

  // start opens the connection. Safe to call more than once; extra calls are
  // ignored while a socket is open or a reconnect is already pending (React
  // Strict Mode runs effects twice in dev).
  start(): void {
    if (this.ws || this.reconnectTimer) return;
    this.connect();
  }

  // onStatus subscribes to connected/disconnected changes; returns an
  // unsubscribe function.
  onStatus(fn: StatusListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  // send returns false when the socket cannot accept the command.
  send(cmd: Command): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(cmd));
      return true;
    } catch {
      return false;
    }
  }

  // sendAction projects one world edit locally while protocol 4 settles it by
  // action ID. During a rolling deploy, older servers keep the previous
  // authoritative-only behavior.
  sendAction(cmd: WorldActionCommand, tiles: TileUpdate[], cost = 0): SentAction | null {
    if (this.serverProtocol < PREDICTED_ACTION_PROTOCOL) {
      if (cost < 0) return null;
      if (cost === 0) return this.send(cmd) ? { predicted: false } : null;
      if (this.legacySpendPending) return null;
      const actionId = this.nextActionId++;
      if (!reserveSpend(actionId, cost)) return null;
      if (!this.send(cmd)) {
        releaseSpend(actionId);
        return null;
      }
      this.legacySpendPending = true;
      return { predicted: false };
    }

    const actionId = this.nextActionId++;
    if (!reserveSpend(actionId, cost)) return null;
    if (!predictAction(actionId, tiles)) {
      releaseSpend(actionId);
      return null;
    }
    if (!this.send({ ...cmd, actionId })) {
      resolveAction(actionId);
      releaseSpend(actionId);
      return null;
    }
    return { predicted: true };
  }

  private connect(): void {
    this.serverProtocol = 0;
    this.legacySpendPending = false;
    const ws = new WebSocket(wsUrl());
    this.ws = ws;

    ws.onopen = () => {
      this.backoff = 500;
      this.emit(true);
      this.startPinging();
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data as string) as ServerMessage;
      if (msg.type === "welcome") this.serverProtocol = msg.protocol ?? 0;
      if (msg.type === "roomFull") this.refused = true;
      handleServerMessage(msg);
      if (msg.type === "stats" && this.serverProtocol < PREDICTED_ACTION_PROTOCOL) {
        this.legacySpendPending = false;
        clearPendingSpend();
      }
    };
    ws.onclose = () => {
      this.stopPinging();
      setPing(null);
      this.serverProtocol = 0;
      this.legacySpendPending = false;
      clearPredictions();
      clearPendingSpend();
      this.emit(false);
      this.ws = null;
      if (this.refused) return; // full room: stay away until the player picks a new one
      this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  // scheduleReconnect retries after a wait that doubles each failure, up to a cap.
  private scheduleReconnect(): void {
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, 10_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private emit(connected: boolean): void {
    for (const fn of this.listeners) fn(connected);
  }

  // Probe the round-trip time every few seconds while connected; the server
  // echoes each ping straight back as a pong (see onmessage).
  private startPinging(): void {
    this.stopPinging(); // never stack a second timer
    this.sendPing();
    this.pingTimer = setInterval(() => this.sendPing(), PING_INTERVAL);
  }

  private stopPinging(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private sendPing(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "ping", t: performance.now() }));
    }
  }
}

// One shared connection for the whole app.
export const connection = new Connection();
