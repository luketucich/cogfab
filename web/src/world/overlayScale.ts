import { MAX_ZOOM, MIN_ZOOM } from "../camera";

const MIN_TOOLTIP_SCALE = 0.78;

// Tooltips carry text rather than ambient status, so they keep a much larger
// legibility floor than the compact progress bar at the far zoom limit.
export function tooltipScale(zoom: number): number {
  const t = Math.min(1, Math.max(0, (zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)));
  return MIN_TOOLTIP_SCALE + (1 - MIN_TOOLTIP_SCALE) * t;
}

export type TooltipSpring = { value: number; velocity: number };

// Tooltips arrive with a quick underdamped spring and leave with a softer,
// nearly critical one. Small integration steps keep the motion stable after a
// backgrounded tab without coupling it to CSS transition timing.
export function stepTooltipSpring(state: TooltipSpring, shown: boolean, delta: number): TooltipSpring {
  const target = shown ? 1 : 0;
  const stiffness = shown ? 420 : 260;
  const damping = shown ? 24 : 30;
  let value = state.value;
  let velocity = state.velocity;
  let remaining = Math.min(Math.max(delta, 0), 0.1);

  while (remaining > 0) {
    const dt = Math.min(remaining, 1 / 120);
    velocity += ((target - value) * stiffness - velocity * damping) * dt;
    value += velocity * dt;
    remaining -= dt;
  }

  if (!shown && Math.abs(value) < 0.001 && Math.abs(velocity) < 0.01) {
    return { value: 0, velocity: 0 };
  }
  return { value, velocity };
}

export function tooltipMotion(value: number, zoomScale: number) {
  const reveal = Math.min(1, Math.max(0, value));
  return {
    opacity: reveal,
    offset: 2 + reveal * 6,
    scale: zoomScale * (0.92 + value * 0.08),
  };
}

// tooltipHorizontalShift keeps a world-anchored panel between the left and
// right HUD columns. It returns only the needed screen-space correction, so a
// tooltip stays directly over its building whenever there is room.
export function tooltipHorizontalShift(
  anchorX: number,
  width: number,
  leftEdge: number,
  rightEdge: number,
  padding = 10,
): number {
  if (![anchorX, width, leftEdge, rightEdge, padding].every(Number.isFinite) || width <= 0) return 0;
  const minCenter = leftEdge + padding + width / 2;
  const maxCenter = rightEdge - padding - width / 2;
  if (minCenter > maxCenter) return 0;
  return Math.min(Math.max(anchorX, minCenter), maxCenter) - anchorX;
}
