// Pending particle bursts: gameplay code queues them, the Bursts renderer
// drains the queue each frame. Module state like the other stores; no notify
// is needed because the renderer already polls every frame.

export type Burst = { x: number; z: number; color: string; count: number };

let queue: Burst[] = [];

// addBurst asks for a puff of particles at a world position.
export function addBurst(burst: Burst): void {
  queue.push(burst);
}

// drainBursts hands over everything queued since the last frame.
export function drainBursts(): Burst[] {
  if (queue.length === 0) return queue;
  const drained = queue;
  queue = [];
  return drained;
}
