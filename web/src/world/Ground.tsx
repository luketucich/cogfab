import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { getLatest } from "./store";
import { cellFromWorld, cellOffsets } from "./grid";
import { connection } from "../net/connection";
import { getSelectedTool } from "../toolbar/tools";

type Cell = { x: number; y: number };

const COLOR = "#6ea8ff";
const TILE = 0.96; // highlight footprint, a hair inside the cell
const H_FLAT = 0.04; // height over empty ground: a thin slab
const H_WRAP = 0.6; // height over a structure: tall enough to wrap it
const FOLLOW = 16; // how fast the highlight slides between cells
const GROW = 14; // how fast it grows or shrinks between flat and wrapping
const FADE = 14; // how fast it fades in and out
const FILL_BASE = 0.16;
const FILL_PULSE = 0.08; // extra fill opacity at the top of each pulse
const EDGE_OPACITY = 0.85;
const PULSE_SPEED = 6; // gentle breathing of the fill, about one pulse a second

// Ground is an invisible plane that catches pointer events. Hovering glides a
// highlight onto the cell under the cursor, growing it to wrap any structure
// there; clicking sends the selected tool's command for that cell.
export function Ground() {
  const target = useRef<Cell | null>(null);
  const placed = useRef(false); // false until the highlight has snapped onto a fresh cell
  const shown = useRef(0); // 0..1 presence, drives the fade

  const group = useRef<THREE.Group>(null!);
  const fillMat = useRef<THREE.MeshBasicMaterial>(null!);
  const edgeMat = useRef<THREE.LineBasicMaterial>(null!);
  const unitBox = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);

  // cellAt returns the grid cell under a pointer or click, or null if it is off
  // the world. Shared by hover and click.
  function cellAt(e: ThreeEvent<PointerEvent | MouseEvent>): Cell | null {
    const snap = getLatest();
    if (!snap) return null;
    return cellFromWorld(e.point.x, e.point.z, snap);
  }

  function onClick(e: ThreeEvent<MouseEvent>) {
    const cell = cellAt(e);
    if (!cell) return;
    // The selected tool decides what command this click becomes.
    connection.send(getSelectedTool().command(cell.x, cell.y));
  }

  useFrame(({ clock }, delta) => {
    const g = group.current;
    const snap = getLatest();
    const cell = target.current;

    // Fade in while hovering a cell, out otherwise.
    shown.current = THREE.MathUtils.damp(shown.current, snap && cell ? 1 : 0, FADE, delta);
    g.visible = shown.current > 0.001;
    if (!g.visible || !snap) return;

    if (cell) {
      const { offX, offZ } = cellOffsets(snap);
      const tx = cell.x - offX;
      const tz = cell.y - offZ;
      if (placed.current) {
        g.position.x = THREE.MathUtils.damp(g.position.x, tx, FOLLOW, delta);
        g.position.z = THREE.MathUtils.damp(g.position.z, tz, FOLLOW, delta);
      } else {
        // First cell after appearing: snap so it does not slide in from afar.
        g.position.x = tx;
        g.position.z = tz;
        placed.current = true;
      }
      // Grow to wrap a structure, lie flat over empty ground.
      const occupied = snap.tiles[cell.y * snap.width + cell.x].kind !== "empty";
      const h = THREE.MathUtils.damp(g.scale.y, occupied ? H_WRAP : H_FLAT, GROW, delta);
      g.scale.y = h;
      g.position.y = h / 2;
    } else {
      // Cursor left the grid; the next cell snaps fresh instead of sliding.
      placed.current = false;
    }

    // Gentle pulse on the fill; both edge and fill fade with presence.
    const pulse = 0.5 + 0.5 * Math.sin(clock.elapsedTime * PULSE_SPEED);
    fillMat.current.opacity = (FILL_BASE + FILL_PULSE * pulse) * shown.current;
    edgeMat.current.opacity = EDGE_OPACITY * shown.current;
  });

  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerMove={(e) => (target.current = cellAt(e))}
        onPointerOut={() => (target.current = null)}
        onClick={onClick}
      >
        <planeGeometry args={[1000, 1000]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      <group ref={group} visible={false} scale={[TILE, H_FLAT, TILE]}>
        <mesh geometry={unitBox} raycast={() => null}>
          <meshBasicMaterial ref={fillMat} color={COLOR} transparent opacity={0} depthWrite={false} />
        </mesh>
        <lineSegments raycast={() => null}>
          <edgesGeometry args={[unitBox]} />
          <lineBasicMaterial ref={edgeMat} color={COLOR} transparent opacity={0} depthWrite={false} />
        </lineSegments>
      </group>
    </>
  );
}
