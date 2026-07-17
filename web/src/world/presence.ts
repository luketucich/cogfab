import type { BuildPreviewMessage, CursorMessage, PresencePlayer } from "../net/types";

// Cursor and preview updates arrive independently in protocol 3. Keeping two
// snapshots prevents a preview drag from rerendering the HUD and cursor layer.

let players: PresencePlayer[] = [];
let previewPlayers: PresencePlayer[] = [];
const listeners = new Set<() => void>();
const previewListeners = new Set<() => void>();

// A full roster bootstraps both snapshots on join and carries identity changes.
export function setPresence(next: PresencePlayer[]): void {
  players = next;
  previewPlayers = next;
  for (const fn of listeners) fn();
  for (const fn of previewListeners) fn();
}

export function setCursor(msg: CursorMessage): void {
  const index = players.findIndex((player) => player.slot === msg.slot);
  if (index < 0) return;
  const previous = players[index];
  players = players.slice();
  players[index] = {
    ...previous,
    on: msg.on,
    sx: msg.sx,
    sy: msg.sy,
    hovering: msg.hovering,
    x: msg.x,
    y: msg.y,
  };
  for (const fn of listeners) fn();
}

export function setPresencePreview(msg: BuildPreviewMessage): void {
  const index = previewPlayers.findIndex((player) => player.slot === msg.slot);
  if (index < 0) return;
  previewPlayers = previewPlayers.slice();
  previewPlayers[index] = { ...previewPlayers[index], preview: msg.preview ?? undefined };
  for (const fn of previewListeners) fn();
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

export function getPreviewPresence(): PresencePlayer[] {
  return previewPlayers;
}

export function subscribePreviewPresence(fn: () => void): () => void {
  previewListeners.add(fn);
  return () => {
    previewListeners.delete(fn);
  };
}
