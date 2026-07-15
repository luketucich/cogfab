import type { PresencePlayer } from "../net/types";

// The latest room roster: every connected player's identity, cursor, and build
// preview, ourselves included. World and overlay renderers subscribe or poll it.

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
