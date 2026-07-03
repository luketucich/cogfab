import { useMemo } from "react";
import { useSyncExternalStore } from "react";
import * as THREE from "three";
import { getLatest, subscribe } from "./store";
import { cellOffsets } from "./grid";
import { chevronGeometry, CHEVRON_ROT } from "./chevron";

const MARKER_Y = 1.3; // float above the machine roofs
const SCALE = 0.6;

// MouthMarkers float a small white arrow over every extractor and seller
// showing the way it faces: ore leaves an extractor through that side and
// enters a seller through it. Rotating a machine spins its arrow with it. The
// arrows skip the depth test and draw last, so no roof or neighbour can ever
// swallow them; a thin dark stroke keeps white readable on the light models.
export function MouthMarkers() {
  const snap = useSyncExternalStore(subscribe, getLatest);
  const geometry = useMemo(() => chevronGeometry(), []);
  // The outline: just the chevron's silhouette (coplanar seams culled).
  const outline = useMemo(() => new THREE.EdgesGeometry(geometry, 1), [geometry]);
  const arrowMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#ffffff",
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        toneMapped: false,
        depthWrite: false,
        depthTest: false,
      }),
    [],
  );
  const strokeMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: "#14171f",
        transparent: true,
        opacity: 0.85,
        toneMapped: false,
        depthWrite: false,
        depthTest: false,
      }),
    [],
  );
  if (!snap) return null;

  const { offX, offZ } = cellOffsets(snap);
  return (
    <group>
      {snap.tiles.map((tile, i) => {
        if (tile.kind !== "extractor" && tile.kind !== "seller") return null;
        const x = (i % snap.width) - offX;
        const z = Math.floor(i / snap.width) - offZ;
        const spin = CHEVRON_ROT[tile.dir];
        return (
          <group key={i} position={[x, MARKER_Y, z]} rotation={[0, spin, 0]} scale={SCALE}>
            <mesh geometry={geometry} material={arrowMat} renderOrder={9} raycast={() => null} />
            <lineSegments geometry={outline} material={strokeMat} renderOrder={10} raycast={() => null} />
          </group>
        );
      })}
    </group>
  );
}
