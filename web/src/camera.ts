// The camera's home view and zoom range, plus a one-shot signal to recentre it,
// fired by the Reset View button and handled inside the Canvas (CameraRig). The
// DOM button and the 3D camera cannot share a ref, so they meet here, the same
// way the toolbar and Ground share the tool.

// Zoom is set by how many tiles fill the view, not a magic number. For an ortho
// camera, zoom is pixels per world unit and a tile is one unit, so zoom = view
// height / tiles tall. Tune by changing the tile counts.
const REF_HEIGHT = 900;
export const DEFAULT_ZOOM = REF_HEIGHT / 18; // comfortable working view, ~18 tiles tall
export const MAX_ZOOM = REF_HEIGHT / 10; // most zoomed in, ~10 tiles tall
export const MIN_ZOOM = REF_HEIGHT / 60; // most zoomed out, ~60 tiles tall
export const CAMERA_POS: [number, number, number] = [18, 18, 18]; // default isometric vantage

const listeners = new Set<() => void>();

export function resetCamera(): void {
  for (const fn of listeners) fn();
}

export function onResetCamera(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
