import type { PresencePlayer } from "../net/types";

// The room's roster, as the server last told it: every connected player's slot
// and cursor position (fractional cell coordinates), ourselves included.
// PlayerCursors reads it per frame; the lobby panel and CursorOverlay subscribe.

let players: PresencePlayer[] = [];
const listeners = new Set<() => void>();

// setPresence records a fresh roster from the server.
export function setPresence(next: PresencePlayer[]): void {
  players = next;
  for (const fn of listeners) fn();
}

export function getPresence(): PresencePlayer[] {
  return players;
}

export function subscribePresence(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
