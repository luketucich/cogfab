import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { MapControls, OrthographicCamera } from "@react-three/drei";
import * as THREE from "three";
import { CAMERA_POS, DEFAULT_ZOOM } from "./camera";
import { CameraRig } from "./CameraRig";
import { Factory } from "./world/Factory";
import { Floor } from "./world/Floor";
import { FlowArrows } from "./world/FlowArrows";
import { FlowItems } from "./world/FlowItems";
import { Bursts } from "./world/Bursts";
import { BuildPreviews } from "./world/BuildPreviews";
import { Ground } from "./world/Ground";
import { HoverGlow } from "./world/HoverGlow";
import { MouthMarkers } from "./world/MouthMarkers";
import { PlayerCursors } from "./world/PlayerCursors";
import { Region } from "./world/Region";
import { ResourceField } from "./world/ResourceField";
import { ResourceTooltip } from "./world/ResourceTooltip";
import { RefinerGlow } from "./world/RefinerGlow";

// Scene is the whole 3D view: a locked isometric camera you pan and zoom like a
// map, soft even lighting, the checkered floor, and the factory. The camera's
// feel (gliding zoom, the reset flight) lives in CameraRig; the zoom range and
// home view live in camera.ts.
export function Scene() {
  return (
    <Canvas style={{ position: "absolute", inset: 0 }} dpr={[1, 1.5]} gl={{ toneMappingExposure: 1.4 }}>
      <color attach="background" args={["#1a1e27"]} />

      {/* Deep near/far so the floor is not clipped when the camera dips below it while zoomed. */}
      <OrthographicCamera makeDefault position={CAMERA_POS} zoom={DEFAULT_ZOOM} near={-1000} far={2000} />
      {/* Panning only: CameraRig owns the wheel, so zooming can glide. */}
      <MapControls
        makeDefault
        enableRotate={false}
        enableZoom={false}
        screenSpacePanning={false}
        enableDamping={false}
        mouseButtons={{ LEFT: undefined, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }}
      />
      <CameraRig />

      <ambientLight intensity={0.45} />
      <hemisphereLight intensity={0.7} color="#eef1f6" groundColor="#3e4450" />
      <directionalLight position={[12, 18, 8]} intensity={2.8} />

      <Floor />
      <Region />
      <Ground />

      <Suspense fallback={null}>
        <ResourceField />
        <BuildPreviews />
        <Factory />
        <HoverGlow />
        <RefinerGlow />
      </Suspense>
      <ResourceTooltip />
      <FlowItems />
      <FlowArrows />
      <MouthMarkers />
      <PlayerCursors />
      <Bursts />
    </Canvas>
  );
}
