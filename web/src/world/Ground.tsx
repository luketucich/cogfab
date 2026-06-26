import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { getLatest } from "./store";
import { cellFromWorld, cellOffsets, cellsBetween, dirBetween, dirFromDelta, type Cell } from "./grid";
import { connection } from "../net/connection";
import { getFacing, getSelectedId, getSelectedTool, rotateFacing, setFacing } from "../toolbar/tools";
import type { Dir } from "../net/types";

const COLOR = "#6ea8ff";
const TILE = 0.96; // highlight footprint, a hair inside the cell
const H_FLAT = 0.04; // height over empty ground: a thin slab
const H_WRAP = 0.6; // height over a structure: tall enough to wrap it
const FOLLOW = 30; // how fast the highlight glides between cells: smooth but quick
const GROW = 14; // how fast it grows or shrinks between flat and wrapping
const FADE = 14; // how fast it fades in and out
const FILL_BASE = 0.16;
const FILL_PULSE = 0.08; // extra fill opacity at the top of each pulse
const EDGE_OPACITY = 0.85;
const PULSE_SPEED = 6; // gentle breathing of the fill, about one pulse a second
const ARROW_Y = 0.08; // height of the facing arrow above the floor
const AIM_STEP = 0.15; // cursor distance (in cells) before the arrow re-aims

// Y rotation that aims the +x arrow toward each direction.
const ARROW_ROT: Record<Dir, number> = {
  east: 0,
  north: Math.PI / 2,
  west: Math.PI,
  south: -Math.PI / 2,
};

// Ground is an invisible plane that catches pointer events. Left-drag lays belts
// along the path you drag, each facing the way you go; a single left-click places
// one facing the current direction (R rotates it). A highlight and a small arrow
// preview the target cell and its facing.
export function Ground() {
  const target = useRef<Cell | null>(null);
  const stroke = useRef<Cell[] | null>(null); // cells of the current drag, in order
  const aimFrom = useRef<{ x: number; z: number } | null>(null); // last point the arrow re-aimed from
  const placed = useRef(false); // false until the highlight has snapped onto a fresh cell
  const shown = useRef(0); // 0..1 presence, drives the fade

  const group = useRef<THREE.Group>(null!);
  const fillMat = useRef<THREE.MeshBasicMaterial>(null!);
  const edgeMat = useRef<THREE.LineBasicMaterial>(null!);
  const arrow = useRef<THREE.Mesh>(null!);
  const arrowMat = useRef<THREE.MeshBasicMaterial>(null!);
  const unitBox = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const arrowGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([0.24, 0, 0, -0.14, 0, 0.16, -0.14, 0, -0.16], 3));
    return g;
  }, []);

  // cellAt returns the grid cell under a pointer event, or null if it is off the
  // world.
  function cellAt(e: ThreeEvent<PointerEvent>): Cell | null {
    const snap = getLatest();
    if (!snap) return null;
    return cellFromWorld(e.point.x, e.point.z, snap);
  }

  function send(cell: Cell, dir: Dir) {
    connection.send(getSelectedTool().command(cell.x, cell.y, dir));
  }

  // extendStroke places every cell the drag just crossed, each facing the next,
  // and leaves the newest cell to be placed when the drag moves on or ends.
  function extendStroke(to: Cell) {
    const cells = stroke.current;
    if (!cells) return;
    let prev = cells[cells.length - 1];
    for (const step of cellsBetween(prev, to)) {
      send(prev, dirBetween(prev, step));
      cells.push(step);
      prev = step;
    }
  }

  // endStroke places the final cell: facing the last drag direction, or the
  // current rotate direction for a single click that never moved.
  function endStroke() {
    const cells = stroke.current;
    if (!cells) return;
    stroke.current = null;
    const last = cells[cells.length - 1];
    const dir = cells.length > 1 ? dirBetween(cells[cells.length - 2], last) : getFacing();
    send(last, dir);
  }

  // aimDir is where the arrow points: the live drag direction, or the rotate
  // direction while hovering.
  function aimDir(): Dir {
    const cells = stroke.current;
    if (cells && cells.length > 1) return dirBetween(cells[cells.length - 2], cells[cells.length - 1]);
    return getFacing();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "r" || e.key === "R") rotateFacing();
    };
    const onUp = () => endStroke(); // finish a drag even if released off the canvas
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  useFrame(({ clock }, delta) => {
    const g = group.current;
    const snap = getLatest();
    const cell = target.current;

    // Fade in while hovering a cell, out otherwise.
    shown.current = THREE.MathUtils.damp(shown.current, snap && cell ? 1 : 0, FADE, delta);
    g.visible = shown.current > 0.001;
    arrow.current.visible = g.visible && getSelectedId() !== "destroy";
    if (!g.visible || !snap) return;

    if (cell) {
      const { offX, offZ } = cellOffsets(snap);
      const tx = cell.x - offX;
      const tz = cell.y - offZ;
      if (placed.current) {
        // Glide to the hovered cell: smooth, but quick enough not to trail.
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

    // Arrow rides along with the highlight and points the aim direction.
    arrow.current.position.set(g.position.x, ARROW_Y, g.position.z);
    arrow.current.rotation.y = ARROW_ROT[aimDir()];

    // Gentle pulse on the fill; everything fades with presence.
    const pulse = 0.5 + 0.5 * Math.sin(clock.elapsedTime * PULSE_SPEED);
    fillMat.current.opacity = (FILL_BASE + FILL_PULSE * pulse) * shown.current;
    edgeMat.current.opacity = EDGE_OPACITY * shown.current;
    arrowMat.current.opacity = EDGE_OPACITY * shown.current;
  });

  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerDown={(e) => {
          if (e.nativeEvent.button !== 0) return; // left builds; right is for panning
          const cell = cellAt(e);
          if (!cell) return;
          target.current = cell;
          stroke.current = [cell];
        }}
        onPointerMove={(e) => {
          const cell = cellAt(e);
          target.current = cell;
          // Aim the arrow by how the cursor moves, fine enough to update within
          // one cell. Re-aim once it has moved a small step so it tracks the
          // mouse without jittering on tiny moves.
          const from = aimFrom.current;
          if (!from) {
            aimFrom.current = { x: e.point.x, z: e.point.z };
          } else {
            const dx = e.point.x - from.x;
            const dz = e.point.z - from.z;
            if (Math.hypot(dx, dz) > AIM_STEP) {
              setFacing(dirFromDelta(dx, dz));
              aimFrom.current = { x: e.point.x, z: e.point.z };
            }
          }
          if (!stroke.current) return;
          // Only extend while the left button is held. If it is not, the drag
          // ended (we missed the pointerup), so finish it instead of running away.
          if (e.nativeEvent.buttons & 1) {
            if (cell) extendStroke(cell);
          } else {
            endStroke();
          }
        }}
        onPointerOut={() => {
          target.current = null;
          aimFrom.current = null;
        }}
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

      <mesh ref={arrow} geometry={arrowGeo} visible={false} raycast={() => null}>
        <meshBasicMaterial ref={arrowMat} color={COLOR} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </>
  );
}
