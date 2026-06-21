import type { StateMessage } from "./types";
import { setLatest } from "../world/store";

const SERVER_URL = "ws://localhost:8080/ws";

type StatusListener = (connected: boolean) => void;

// Connection owns the single WebSocket to the game server. It lives outside
// React so it survives component re-mounts, decodes incoming snapshots into the
// world store, and reconnects with backoff if the socket drops.
class Connection {
  private ws: WebSocket | null = null;
  private backoff = 500; // ms; doubles on each failed attempt, capped
  private listeners = new Set<StatusListener>();

  // start opens the connection. Safe to call more than once (e.g. React Strict
  // Mode mounts effects twice in dev) — extra calls are ignored.
  start(): void {
    if (this.ws) return;
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

  private connect(): void {
    const ws = new WebSocket(SERVER_URL);
    this.ws = ws;

    ws.onopen = () => {
      this.backoff = 500;
      this.emit(true);
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data as string) as StateMessage;
      if (msg.type === "state") setLatest(msg);
    };
    ws.onclose = () => {
      this.emit(false);
      this.ws = null;
      this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleReconnect(): void {
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, 10_000);
    setTimeout(() => this.connect(), delay);
  }

  private emit(connected: boolean): void {
    for (const fn of this.listeners) fn(connected);
  }
}

// One shared connection for the whole app.
export const connection = new Connection();
