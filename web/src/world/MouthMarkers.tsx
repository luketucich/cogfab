import { useSyncExternalStore } from "react";
import { getLatest, subscribe } from "./store";
import { cellOffsets } from "./grid";
import { DirectionIndicator } from "./DirectionIndicator";

const MARKER_Y = 1.3; // float above the machine roofs

// MouthMarkers show which way each placed extractor, seller, and refiner faces.
export function MouthMarkers() {
  const snap = useSyncExternalStore(subscribe, getLatest);
  if (!snap) return null;

  const { offX, offZ } = cellOffsets(snap);
  return (
    <group>
      {snap.tiles.map((tile, i) => {
        if (tile.kind !== "extractor" && tile.kind !== "seller" && tile.kind !== "refiner") return null;
        const x = (i % snap.width) - offX;
        const z = Math.floor(i / snap.width) - offZ;
        return (
          <group key={i} position={[x, 0, z]}>
            <DirectionIndicator direction={tile.dir} y={MARKER_Y} />
          </group>
        );
      })}
    </group>
  );
}
