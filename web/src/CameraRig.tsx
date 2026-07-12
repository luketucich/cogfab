import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { CAMERA_POS, DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, onResetCamera } from "./camera";
import { isTyping } from "./ui";

const WHEEL_FEEL = 0.0028; // how much one wheel notch changes the zoom target
const ZOOM_DAMP = 9; // how quickly the camera glides to that target
const FLIGHT_SECONDS = 0.6; // how long the reset-view flight takes
const TURN_SECONDS = 0.45; // how long a Q/E quarter turn takes

// PanControls is the slice of MapControls we drive (drei exposes no clean type
// for state.controls).
type PanControls = { target: THREE.Vector3; update: () => void };

// A reset flight in progress: where it started and how far along it is.
type Flight = { t: number; fromPos: THREE.Vector3; fromTarget: THREE.Vector3; fromZoom: number };

// A quarter turn in progress: the camera orbits the pan target from one angle
// to the next, keeping its distance and height.
type Turn = { t: number; from: number; to: number; radius: number };

// easeInOut applies cubic easing to camera transitions.
const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// CameraRig owns the camera feel: the wheel sets a zoom target the camera
// glides toward (anchored on the cursor so the spot under it stays put), Q and
// E spin the view a quarter turn, and Reset View flies home over a moment
// instead of snapping.
export function CameraRig() {
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera;
  const controls = useThree((s) => s.controls) as unknown as PanControls | null;
  const gl = useThree((s) => s.gl);

  const targetZoom = useRef(DEFAULT_ZOOM);
  const anchor = useRef<{ ndc: THREE.Vector2; point: THREE.Vector3 } | null>(null);
  const flight = useRef<Flight | null>(null);
  const turn = useRef<Turn | null>(null);

  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const floor = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const probe = useMemo(() => new THREE.Vector3(), []);
  const home = useMemo(() => ({ pos: new THREE.Vector3(...CAMERA_POS), target: new THREE.Vector3(0, 0, 0) }), []);

  // groundPoint is where a screen position lands on the floor plane.
  function groundPoint(ndc: THREE.Vector2, out: THREE.Vector3): THREE.Vector3 | null {
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray.intersectPlane(floor, out);
  }

  // The wheel only moves the target; useFrame glides the real zoom after it.
  useEffect(() => {
    const el = gl.domElement;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      flight.current = null; // zooming mid-flight or mid-turn takes back control
      turn.current = null;
      targetZoom.current = THREE.MathUtils.clamp(targetZoom.current * Math.exp(-e.deltaY * WHEEL_FEEL), MIN_ZOOM, MAX_ZOOM);
      const rect = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const point = new THREE.Vector3();
      if (groundPoint(ndc, point)) anchor.current = { ndc, point };
    };
    // Dragging mid-flight also takes back control, so the camera never fights
    // the player; the zoom anchor goes too, so an old cursor point cannot tug
    // at a freshly panned view.
    const onPointerDown = () => {
      flight.current = null;
      anchor.current = null;
    };
    // Q and E orbit the view a quarter turn around the pan target. Pressing
    // again mid-turn chains smoothly onto the next quarter.
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const left = e.key === "q" || e.key === "Q";
      const right = e.key === "e" || e.key === "E";
      if ((!left && !right) || !controls) return;
      flight.current = null;
      anchor.current = null; // a turn moves the view out from under the zoom anchor
      const dx = camera.position.x - controls.target.x;
      const dz = camera.position.z - controls.target.z;
      const t = turn.current;
      const from = t ? THREE.MathUtils.lerp(t.from, t.to, easeInOut(t.t)) : Math.atan2(dz, dx);
      const to = (t ? t.to : from) + (left ? 1 : -1) * (Math.PI / 2);
      turn.current = { t: 0, from, to, radius: Math.hypot(dx, dz) };
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
    // The handlers read refs and stable three.js objects; re-binding them on
    // every render would drop in-flight gestures for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, camera, controls]);

  useEffect(
    () =>
      onResetCamera(() => {
        if (!controls) return;
        flight.current = {
          t: 0,
          fromPos: camera.position.clone(),
          fromTarget: controls.target.clone(),
          fromZoom: camera.zoom,
        };
        turn.current = null;
        targetZoom.current = DEFAULT_ZOOM;
        anchor.current = null;
      }),
    [camera, controls],
  );

  useFrame((_, delta) => {
    if (!controls) return;

    // A reset flight overrides everything until it lands or is interrupted.
    if (flight.current) {
      const f = flight.current;
      f.t = Math.min(f.t + delta / FLIGHT_SECONDS, 1);
      const k = easeInOut(f.t);
      camera.position.lerpVectors(f.fromPos, home.pos, k);
      controls.target.lerpVectors(f.fromTarget, home.target, k);
      camera.zoom = THREE.MathUtils.lerp(f.fromZoom, DEFAULT_ZOOM, k);
      camera.updateProjectionMatrix();
      controls.update();
      if (f.t >= 1) flight.current = null;
      return;
    }

    // A quarter turn orbits the camera around wherever the view is panned.
    if (turn.current) {
      const tn = turn.current;
      tn.t = Math.min(tn.t + delta / TURN_SECONDS, 1);
      const angle = THREE.MathUtils.lerp(tn.from, tn.to, easeInOut(tn.t));
      camera.position.x = controls.target.x + Math.cos(angle) * tn.radius;
      camera.position.z = controls.target.z + Math.sin(angle) * tn.radius;
      controls.update();
      if (tn.t >= 1) turn.current = null;
      return;
    }

    // Glide the zoom toward the wheel's target, keeping the ground point under
    // the cursor pinned so zooming feels like diving at what you point at.
    if (Math.abs(camera.zoom / targetZoom.current - 1) > 0.001) {
      camera.zoom = THREE.MathUtils.damp(camera.zoom, targetZoom.current, ZOOM_DAMP, delta);
      camera.updateProjectionMatrix();
      const a = anchor.current;
      if (a && groundPoint(a.ndc, probe)) {
        const dx = a.point.x - probe.x;
        const dz = a.point.z - probe.z;
        camera.position.x += dx;
        camera.position.z += dz;
        controls.target.x += dx;
        controls.target.z += dz;
        controls.update();
      }
    }
  });

  return null;
}
