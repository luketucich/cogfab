import type { Command, ServerMessage } from "./types";
import { setLatest } from "../world/store";
import { setStats } from "../world/economy";
import { setPresence } from "../world/presence";
import { setRoomFull, setSession } from "./session";
import { setPing } from "./ping";

const PING_INTERVAL = 2000; // ms between round-trip probes

// wsUrl is where the game server lives: derived from the page in production,
// a localhost fallback in dev (Vite serves the page, Go serves the game). The
// room code rides along from the address bar, and because location is read
// fresh on every attempt, reconnects follow whatever room the URL names.
export function wsUrl(loc: Pick<Location, "protocol" | "host" | "search"> = location, dev = import.meta.env.DEV): string {
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  const host = dev ? "localhost:8080" : loc.host;
  const room = new URLSearchParams(loc.search).get("room");
  return `${proto}//${host}/ws${room ? `?room=${room}` : ""}`;
}

type StatusListener = (connected: boolean) => void;

// Connection owns the single WebSocket to the game server. It lives outside
// React so it survives component re-mounts, decodes incoming snapshots into the
// world store, and reconnects with backoff if the socket drops.
class Connection {
  private ws: WebSocket | null = null;
  private backoff = 500; // ms; doubles on each failed attempt, capped
  private listeners = new Set<StatusListener>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private refused = false; // the room was full; reconnecting would just knock again

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

  // send sends a command to the server, dropping it if the socket is not open
  // yet (still connecting, or already closed).
  send(cmd: Command): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(cmd));
  }

  private connect(): void {
    const ws = new WebSocket(wsUrl());
    this.ws = ws;

    ws.onopen = () => {
      this.backoff = 500;
      this.emit(true);
      this.startPinging();
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data as string) as ServerMessage;
      if (msg.type === "state") setLatest(msg);
      else if (msg.type === "stats") setStats(msg);
      else if (msg.type === "welcome") {
        setSession(msg.room, msg.slot);
        // The server's code is authoritative: write it into the address bar so
        // the URL is the invite link and a reconnect rejoins the same room.
        history.replaceState(null, "", `${location.pathname}?room=${msg.room}`);
      } else if (msg.type === "presence") setPresence(msg.players);
      else if (msg.type === "roomFull") {
        this.refused = true;
        setRoomFull();
      } else if (msg.type === "pong") setPing(performance.now() - msg.t);
    };
    ws.onclose = () => {
      this.stopPinging();
      setPing(null);
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
