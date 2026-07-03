import type { Cell } from "./grid";
import { connection } from "../net/connection";
import { subscribeSession } from "../net/session";

// The grid cell the cursor is over, or null. Module state (not React) so Ground
// can publish it and HoverGlow can read it each frame, the same pattern as the
// facing in toolbar/tools.ts. Each change is also shared with the room, so the
// other players can see where we are pointing.

let hovered: Cell | null = null;

export const getHover = (): Cell | null => hovered;

// Sharing the hover: only when the cell actually changes, at most one send
// every 50ms with a trailing send, so scrubbing the mouse costs a few tiny
// messages a second instead of hundreds.
const SEND_EVERY = 50; // ms
let lastSent = -Infinity;
let pending: ReturnType<typeof setTimeout> | null = null;

function sendHover(): void {
  lastSent = performance.now();
  connection.send(
    hovered ? { type: "hover", hovering: true, x: hovered.x, y: hovered.y } : { type: "hover", hovering: false, x: 0, y: 0 },
  );
}

export function setHover(cell: Cell | null): void {
  const same = cell === hovered || (cell !== null && hovered !== null && cell.x === hovered.x && cell.y === hovered.y);
  hovered = cell;
  if (same) return;
  const wait = SEND_EVERY - (performance.now() - lastSent);
  if (wait <= 0) {
    if (pending) {
      clearTimeout(pending);
      pending = null;
    }
    sendHover();
  } else if (!pending) {
    pending = setTimeout(() => {
      pending = null;
      sendHover();
    }, wait);
  }
}

// A fresh welcome means a fresh connection (first join or a reconnect), so
// re-share the current hover: our cursor reappears for the others without
// waiting for the mouse to move.
subscribeSession(sendHover);
