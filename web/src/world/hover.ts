import type { Cell } from "./grid";
import { connection } from "../net/connection";
import { subscribeSession } from "../net/session";

// Where this player's mouse is, for two audiences. Locally: the hovered grid
// cell, module state (not React) so Ground can publish it and HoverGlow can
// read it each frame. For the room: the whole picture, the mouse's spot on the
// screen (for the named cursor everyone sees) plus the grid spot it is over
// (for the cell marker), shared through one throttled sender.

let hovered: Cell | null = null;
let gridX = 0; // the grid spot, in fractional cell coordinates
let gridY = 0;
let onScreen = false;
let screenX = 0; // the mouse, in screen fractions
let screenY = 0;

export const getHover = (): Cell | null => hovered;

// Sharing the mouse: at most one message every 50ms with a trailing send, and
// only when it actually moved, so waving it around costs a handful of tiny
// messages a second instead of hundreds.
const SEND_EVERY = 50; // ms
const MOVED = 0.002; // screen fractions; below this the mouse counts as still
let sent = { on: false, sx: 0, sy: 0, hovering: false };
let lastSentAt = -Infinity;
let pending: ReturnType<typeof setTimeout> | null = null;

function sendCursor(): void {
  lastSentAt = performance.now();
  sent = { on: onScreen, sx: screenX, sy: screenY, hovering: hovered !== null };
  connection.send({ type: "hover", on: sent.on, sx: sent.sx, sy: sent.sy, hovering: sent.hovering, cx: gridX, cy: gridY });
}

function shareCursor(): void {
  const moved =
    onScreen !== sent.on ||
    (hovered !== null) !== sent.hovering ||
    Math.abs(screenX - sent.sx) > MOVED ||
    Math.abs(screenY - sent.sy) > MOVED;
  if (!moved) return;
  const wait = SEND_EVERY - (performance.now() - lastSentAt);
  if (wait <= 0) {
    if (pending) {
      clearTimeout(pending);
      pending = null;
    }
    sendCursor();
  } else if (!pending) {
    pending = setTimeout(() => {
      pending = null;
      sendCursor();
    }, wait);
  }
}

// setHover records the hovered cell and, when the caller knows it, the exact
// grid spot under the mouse.
export function setHover(cell: Cell | null, gridSpot?: { x: number; y: number }): void {
  hovered = cell;
  if (gridSpot) {
    gridX = gridSpot.x;
    gridY = gridSpot.y;
  }
  shareCursor();
}

// pointerMoved and pointerLeft record where the mouse is on the screen, as
// fractions of the window, so the cursor is shared over the HUD and panels
// too, not just the grid.
export function pointerMoved(sx: number, sy: number): void {
  onScreen = true;
  screenX = sx;
  screenY = sy;
  shareCursor();
}

export function pointerLeft(): void {
  onScreen = false;
  shareCursor();
}

// The window feeds them. (Guarded for the test runner, which imports this
// module without a browser and calls the handlers directly.)
if (typeof window !== "undefined") {
  window.addEventListener("pointermove", (e) => {
    pointerMoved(e.clientX / window.innerWidth, e.clientY / window.innerHeight);
  });
  document.documentElement.addEventListener("pointerleave", pointerLeft);
}

// A fresh welcome means a fresh connection (first join or a reconnect), so
// re-share the cursor: it reappears for the others without waiting for a move.
subscribeSession(sendCursor);
