// A one-shot signal to recentre the camera, fired by the Reset View button and
// handled inside the Canvas. The DOM button and the 3D camera cannot share a
// ref, so they meet here, the same way the toolbar and Ground share the tool.
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
