import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { MapControls, OrthographicCamera } from "@react-three/drei";
import { Factory } from "./world/Factory";
import { Floor } from "./world/Floor";
import { Ground } from "./world/Ground";

// Scale is anchored to how many tiles fill the view, not a magic zoom number.
// For an R3F orthographic camera, zoom is pixels per world unit, and one cell is
// one world unit, so zoom = (reference view height) / (tiles tall). Tune the feel
// by editing the tile counts.
const REF_HEIGHT = 900;
const DEFAULT_ZOOM = REF_HEIGHT / 18; // comfortable working view, ~18 tiles tall
const MAX_ZOOM = REF_HEIGHT / 10; // most zoomed in, ~10 tiles tall
const MIN_ZOOM = REF_HEIGHT / 60; // most zoomed out, ~60 tiles tall

// Scene is the whole 3D view: a locked isometric camera you pan and zoom like a
// map, soft even lighting, the checkered floor, and the factory.
export function Scene() {
  return (
    <Canvas style={{ position: "absolute", inset: 0 }} dpr={[1, 1.5]} gl={{ toneMappingExposure: 1.4 }}>
      <color attach="background" args={["#1a1e27"]} />

      {/* Deep near/far so the floor is not clipped when zoom-to-cursor dips the camera below it. */}
      <OrthographicCamera makeDefault position={[18, 18, 18]} zoom={DEFAULT_ZOOM} near={-1000} far={2000} />
      <MapControls
        makeDefault
        enableRotate={false}
        screenSpacePanning={false}
        zoomToCursor
        enableDamping={false}
        zoomSpeed={0.8}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
      />

      <ambientLight intensity={0.45} />
      <hemisphereLight intensity={0.7} color="#eef1f6" groundColor="#3e4450" />
      <directionalLight position={[12, 18, 8]} intensity={2.8} />

      <Floor />
      <Ground />

      <Suspense fallback={null}>
        <Factory />
      </Suspense>
    </Canvas>
  );
}
