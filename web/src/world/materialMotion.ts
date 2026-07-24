// spacedBehind keeps a following item one gap behind the item ahead. Returning
// null trims visual overflow once a stopped line has filled back to its source.
export function spacedBehind(front: number | undefined, distance: number, gap: number): number | null {
  if (front === undefined) return distance;
  const maxDistance = front - gap;
  if (maxDistance < 0) return null;
  return Math.min(distance, maxDistance);
}
