import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

// The floor is a big checkerboard that follows the camera, so it always fills
// the view and never shows an edge. It snaps to the checker period, so the
// pattern stays welded to the world grid (every belt sits on one square) while
// the mesh quietly recentres under the camera.
const PLANE = 600; // world units across, always wider than the view
const CHECK_PERIOD = 2; // world units per checker tile (2x2 texture, 1 texel per cell)

const CHECK_LIGHT = "#454f61";
const CHECK_DARK = "#3b4454";

// makeCheckerTexture draws a 2x2 checker and tiles it one texel per world cell.
function makeCheckerTexture(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 2;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = CHECK_LIGHT;
  ctx.fillRect(0, 0, 2, 2);
  ctx.fillStyle = CHECK_DARK;
  ctx.fillRect(0, 0, 1, 1);
  ctx.fillRect(1, 1, 1, 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(PLANE / 2, PLANE / 2);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function Floor() {
  const texture = useMemo(makeCheckerTexture, []);
  const mesh = useRef<THREE.Mesh>(null!);
  // R3F types state.controls as the generic EventDispatcher; MapControls adds .target.
  const controls = useThree((state) => state.controls) as unknown as
    | { target: THREE.Vector3 }
    | null;

  useFrame(() => {
    const target = controls?.target;
    if (!target) return;
    // Snap to the checker period so the pattern stays welded to the world grid.
    mesh.current.position.x = Math.round(target.x / CHECK_PERIOD) * CHECK_PERIOD;
    mesh.current.position.z = Math.round(target.z / CHECK_PERIOD) * CHECK_PERIOD;
  });

  return (
    <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[PLANE, PLANE]} />
      {/* DoubleSide so the floor still draws if zoom-to-cursor dips the camera below it. */}
      <meshBasicMaterial map={texture} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  );
}
