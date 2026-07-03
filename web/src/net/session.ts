// This player's seat in the world: which room we are in, which slot (and so
// which colour) we hold, and whether we were turned away because the room was
// full. Same module-store pattern as the rest; connection.ts writes it, the
// HUD and the room-full overlay read it.

type Session = {
  room: string | null; // the code in the invite link; null until the welcome
  slot: number; // 0-3; doubles as our colour (PLAYER_COLORS in ui.ts)
  full: boolean; // the room refused us; do not reconnect to it
};

let session: Session = { room: null, slot: 0, full: false };
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

// setSession records the server's welcome: the authoritative room and slot.
export function setSession(room: string, slot: number): void {
  session = { ...session, room, slot };
  notify();
}

// setRoomFull marks that this room turned us away.
export function setRoomFull(): void {
  session = { ...session, full: true };
  notify();
}

export function getSession(): Session {
  return session;
}

export function subscribeSession(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
