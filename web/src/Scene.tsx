import { Suspense, useEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { MapControls, OrthographicCamera } from "@react-three/drei";
import * as THREE from "three";
import { onResetCamera } from "./camera";
import { Factory } from "./world/Factory";
import { Floor } from "./world/Floor";
import { FlowArrows } from "./world/FlowArrows";
import { FlowItems } from "./world/FlowItems";
import { Ground } from "./world/Ground";
import { HoverGlow } from "./world/HoverGlow";
import { Region } from "./world/Region";

// Zoom is set by how many tiles fill the view, not a magic number. For an ortho
// camera, zoom is pixels per world unit and a tile is one unit, so zoom = view
// height / tiles tall. Tune by changing the tile counts below.
const REF_HEIGHT = 900;
const DEFAULT_ZOOM = REF_HEIGHT / 18; // comfortable working view, ~18 tiles tall
const MAX_ZOOM = REF_HEIGHT / 10; // most zoomed in, ~10 tiles tall
const MIN_ZOOM = REF_HEIGHT / 60; // most zoomed out, ~60 tiles tall
const CAMERA_POS: [number, number, number] = [18, 18, 18]; // default isometric vantage

// PanControls is the slice of MapControls the reset uses (drei exposes no clean
// type for state.controls).
type PanControls = { target: THREE.Vector3; update: () => void };

// CameraReset handles the Reset View button. It lives in the Canvas so it can
// reach the camera and controls.
function CameraReset() {
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera;
  const controls = useThree((s) => s.controls) as unknown as PanControls | null;
  useEffect(
    () =>
      onResetCamera(() => {
        camera.position.set(...CAMERA_POS);
        camera.zoom = DEFAULT_ZOOM;
        camera.updateProjectionMatrix();
        if (controls) {
          controls.target.set(0, 0, 0);
          controls.update();
        }
      }),
    [camera, controls],
  );
  return null;
}

// Scene is the whole 3D view: a locked isometric camera you pan and zoom like a
// map, soft even lighting, the checkered floor, and the factory.
export function Scene() {
  return (
    <Canvas style={{ position: "absolute", inset: 0 }} dpr={[1, 1.5]} gl={{ toneMappingExposure: 1.4 }}>
      <color attach="background" args={["#1a1e27"]} />

      {/* Deep near/far so the floor is not clipped when zoom-to-cursor dips the camera below it. */}
      <OrthographicCamera makeDefault position={CAMERA_POS} zoom={DEFAULT_ZOOM} near={-1000} far={2000} />
      <MapControls
        makeDefault
        enableRotate={false}
        screenSpacePanning={false}
        zoomToCursor
        enableDamping={false}
        zoomSpeed={0.8}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        mouseButtons={{ LEFT: undefined, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
      />
      <CameraReset />

      <ambientLight intensity={0.45} />
      <hemisphereLight intensity={0.7} color="#eef1f6" groundColor="#3e4450" />
      <directionalLight position={[12, 18, 8]} intensity={2.8} />

      <Floor />
      <Region />
      <Ground />

      <Suspense fallback={null}>
        <Factory />
        <HoverGlow />
      </Suspense>
      <FlowItems />
      <FlowArrows />
    </Canvas>
  );
}
