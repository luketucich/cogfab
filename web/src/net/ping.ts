// The latest round-trip time to the server in milliseconds, or null when not
// connected. Kept outside React like the world and economy stores; the HUD's ping
// bar reads it.

let ping: number | null = null;
const listeners = new Set<() => void>();

// setPing records a fresh measurement (or null when the socket drops).
export function setPing(ms: number | null): void {
  ping = ms;
  for (const fn of listeners) fn();
}

export function getPing(): number | null {
  return ping;
}

export function subscribePing(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
