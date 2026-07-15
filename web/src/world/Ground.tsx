import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useFrame } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { getLatest, subscribe } from "./store";
import { addPendingSpend, getStats, spendableOre, subscribeStats } from "./economy";
import { cellFromWorld, cellIndex, cellOffsets, cellsBetween, dirBetween, dirFromDelta, isUnlocked, unlockedRect, CURSOR_TILE, type Cell } from "./grid";
import { connection } from "../net/connection";
import { getFacing, getSelectedId, getSelectedTool, rotateFacing, setFacing } from "../toolbar/tools";
import { getHover, setHover } from "./hover";
import { ACCENT, DANGER, isTyping } from "../ui";
import { sfx } from "../sfx";
import { addBurst } from "./burst";
import { chevronGeometry, CHEVRON_ROT } from "./chevron";
import { BeltStrokePreview } from "./BeltStrokePreview";
import { beltPlacements, extendBeltStroke } from "./beltStroke";
import type { BeltPlacement, Dir, StateMessage } from "../net/types";

const TILE = CURSOR_TILE;
const TILE_Y = 0.02; // sit just above the floor
const TILE_OPACITY = 0.28; // a soft glow, not a hard outline
const ARROW_Y = 0.08; // height of the facing arrow above the floor
const ARROW_OPACITY = 0.9;
const FOLLOW = 30; // how fast the highlight glides between cells: smooth but quick
const FADE = 14; // how fast it fades in and out
const AIM_STEP = 0.15; // cursor distance (in cells) before the arrow re-aims

// kindAt is what sits on a cell; cellUnlocked is whether players may build there.
const kindAt = (snap: StateMessage, cell: Cell) => snap.tiles[cellIndex(snap, cell.x, cell.y)].kind;
const cellUnlocked = (snap: StateMessage, cell: Cell) => {
  const stats = getStats();
  return isUnlocked(unlockedRect(snap, stats.gridWidth, stats.gridHeight), cell.x, cell.y);
};

// Ground is an invisible plane that catches pointer events. Left-drag lays belts
// along the path you drag, each facing the way you go; a single left-click places
// one facing the current direction (R rotates it). An empty target cell previews
// as a soft glow tile and a facing arrow; structures light up via HoverGlow.
export function Ground() {
  const target = useRef<Cell | null>(null);
  const stroke = useRef<Cell[] | null>(null); // cells of the current drag, in order
  const strokeAnchor = useRef<Cell | null>(null); // occupied start used only to aim the first belt
  const aimFrom = useRef<{ x: number; z: number } | null>(null); // last point the arrow re-aimed from
  const placed = useRef(false); // false until the highlight has snapped onto a fresh cell
  const shown = useRef(0); // 0..1 presence, drives the fade
  const shiftLock = useRef(false); // holding Shift freezes the placement direction

  const group = useRef<THREE.Group>(null!);
  const tileMat = useRef<THREE.MeshBasicMaterial>(null!);
  const arrow = useRef<THREE.Mesh>(null!);
  const arrowMat = useRef<THREE.MeshBasicMaterial>(null!);
  const arrowGeo = useMemo(() => chevronGeometry(), []);
  const [preview, setPreview] = useState<BeltPlacement[]>([]);
  const latest = useSyncExternalStore(subscribe, getLatest);
  useSyncExternalStore(subscribeStats, getStats);

  // pointerAt reads a pointer event as grid positions: the cell under it (null
  // when it is off the world) and its exact spot in cell coordinates, for the
  // live cursor the other players see.
  function pointerAt(e: ThreeEvent<PointerEvent>): { cell: Cell | null; spot?: { x: number; y: number } } {
    const snap = getLatest();
    if (!snap) return { cell: null };
    const { offX, offZ } = cellOffsets(snap);
    return {
      cell: cellFromWorld(e.point.x, e.point.z, snap),
      spot: { x: e.point.x + offX, y: e.point.z + offZ },
    };
  }

  // canApply mirrors the server's checks for a single-cell command.
  function canApply(cell: Cell): boolean {
    const snap = getLatest();
    if (!snap || !cellUnlocked(snap, cell)) return false;
    const tool = getSelectedTool();
    if (tool.id === "destroy") return kindAt(snap, cell) !== "empty";
    return kindAt(snap, cell) === "empty" && (tool.cost ?? 0) <= spendableOre();
  }

  function sendOne(cell: Cell, dir: Dir) {
    const snap = getLatest();
    if (!snap || !canApply(cell)) return;
    const tool = getSelectedTool();
    connection.send(tool.command(cell.x, cell.y, dir));
    addPendingSpend(tool.cost ?? 0);
    // A thock and a puff of dust where it landed (debris when tearing down).
    const { offX, offZ } = cellOffsets(snap);
    if (tool.id === "destroy") {
      sfx.destroy();
      addBurst({ x: cell.x - offX, z: cell.y - offZ, color: "#8a8f9a", count: 10 });
    } else {
      sfx.place();
      addBurst({ x: cell.x - offX, z: cell.y - offZ, color: "#9fc4ff", count: 8 });
    }
  }

  // canPlaceBeltStroke mirrors the server's all-or-nothing validation against
  // the newest room state. The server repeats it because another player may
  // build after this preview was drawn.
  function canPlaceBeltStroke(placements: BeltPlacement[]): boolean {
    const snap = getLatest();
    const cost = getSelectedTool().cost ?? 0;
    return (
      !!snap &&
      placements.length > 0 &&
      placements.length * cost <= spendableOre() &&
      placements.every((cell) => cellUnlocked(snap, cell) && kindAt(snap, cell) === "empty")
    );
  }

  function showBeltPreview(cells: Cell[]) {
    setPreview(beltPlacements(cells, getFacing(), shiftLock.current));
  }

  function clearStroke() {
    stroke.current = null;
    strokeAnchor.current = null;
    setPreview([]);
  }

  // Belt drags only update their local preview. Other tools keep their existing
  // single-command drag behavior.
  function extendStroke(to: Cell) {
    const cells = stroke.current;
    if (!cells) return;
    if (getSelectedId() === "belt") {
      const anchor = strokeAnchor.current;
      let next = cells;
      if (cells.length > 0) {
        next = extendBeltStroke(cells, to);
      } else if (anchor) {
        next = extendBeltStroke([anchor], to).slice(1);
      }
      if (anchor && to.x === anchor.x && to.y === anchor.y && latest && kindAt(latest, anchor) !== "empty") {
        next = [];
      }
      stroke.current = next;
      showBeltPreview(next);
      return;
    }
    let prev = cells[cells.length - 1];
    for (const step of cellsBetween(prev, to)) {
      sendOne(prev, shiftLock.current ? getFacing() : dirBetween(prev, step));
      cells.push(step);
      prev = step;
    }
  }

  // endStroke sends one atomic belt command, or finishes a non-belt drag with
  // its final single-cell command.
  function endStroke() {
    const cells = stroke.current;
    if (!cells) return;
    if (getSelectedId() === "belt") {
      if (cells.length === 0) {
        clearStroke();
        return;
      }
      const placements = beltPlacements(cells, getFacing(), shiftLock.current);
      const valid = canPlaceBeltStroke(placements);
      clearStroke();
      if (!valid) {
        sfx.deny();
        return;
      }
      connection.send({ type: "beltStroke", placements });
      addPendingSpend(placements.length * (getSelectedTool().cost ?? 0));
      const snap = getLatest();
      if (snap) {
        const { offX, offZ } = cellOffsets(snap);
        for (const cell of placements) {
          addBurst({ x: cell.x - offX, z: cell.y - offZ, color: "#9fc4ff", count: 4 });
        }
      }
      sfx.place();
      return;
    }

    clearStroke();
    const last = cells[cells.length - 1];
    const drag = cells.length > 1 && !shiftLock.current;
    sendOne(last, drag ? dirBetween(cells[cells.length - 2], last) : getFacing());
  }

  // aimDir is where the arrow points: the live drag direction, or the rotate
  // direction while hovering or while Shift holds it frozen.
  function aimDir(): Dir {
    const cells = stroke.current;
    if (cells && cells.length > 1 && !shiftLock.current) {
      return dirBetween(cells[cells.length - 2], cells[cells.length - 1]);
    }
    return getFacing();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (e.key === "Shift") {
        shiftLock.current = true;
        if (stroke.current && getSelectedId() === "belt") showBeltPreview(stroke.current);
        return;
      }
      if (e.repeat || (e.key !== "r" && e.key !== "R")) return;
      // R over a structure spins it in place (free); over empty ground it spins
      // the placement direction.
      const snap = getLatest();
      const cell = getHover();
      if (snap && cell && cellUnlocked(snap, cell) && kindAt(snap, cell) !== "empty") {
        connection.send({ type: "rotate", x: cell.x, y: cell.y });
        sfx.select();
      } else {
        rotateFacing();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== "Shift") return;
      shiftLock.current = false;
      if (stroke.current && getSelectedId() === "belt") showBeltPreview(stroke.current);
    };
    const onUp = (e: PointerEvent) => {
      // Finish the build only when released over the grid. A release over the
      // toolbar or other UI cancels the stroke, so clicking a tool never builds.
      if (e.target instanceof HTMLCanvasElement) endStroke();
      else clearStroke();
    };
    const onLeave = () => {
      // Pointer left the window, so onPointerOut never fires on the ground.
      // Drop the hover so the preview does not strand on the last cell.
      target.current = null;
      aimFrom.current = null;
      setHover(null);
      clearStroke();
    };
    const onOut = (e: PointerEvent) => {
      if (e.relatedTarget === null) onLeave(); // pointer left the window entirely
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointerout", onOut);
    window.addEventListener("blur", onLeave);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointerout", onOut);
      window.removeEventListener("blur", onLeave);
    };
  }, []);

  useFrame((_, delta) => {
    const g = group.current;
    const snap = getLatest();
    const cell = target.current;
    // Preview only over an unlocked empty cell with a build tool: structures get
    // the hover glow, destroy has nothing to place, and locked land is off-limits.
    const active =
      preview.length === 0 &&
      !!snap &&
      !!cell &&
      kindAt(snap, cell) === "empty" &&
      getSelectedId() !== "destroy" &&
      cellUnlocked(snap, cell);
    // The preview turns red when the ore does not cover the selected tool.
    const affordable = (getSelectedTool().cost ?? 0) <= spendableOre();
    tileMat.current.color.set(affordable ? ACCENT : DANGER);
    arrowMat.current.color.set(affordable ? ACCENT : DANGER);

    shown.current = THREE.MathUtils.damp(shown.current, active ? 1 : 0, FADE, delta);
    g.visible = shown.current > 0.001;
    arrow.current.visible = g.visible;
    if (!g.visible) {
      placed.current = false; // next appearance snaps in instead of gliding from afar
      return;
    }

    if (active && snap && cell) {
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
    }

    // Arrow rides along with the tile and points the aim direction.
    arrow.current.position.set(g.position.x, ARROW_Y, g.position.z);
    arrow.current.rotation.y = CHEVRON_ROT[aimDir()];

    tileMat.current.opacity = TILE_OPACITY * shown.current;
    arrowMat.current.opacity = ARROW_OPACITY * shown.current;
  });

  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerDown={(e) => {
          if (e.nativeEvent.button !== 0) return; // left builds; right is for panning
          const { cell, spot } = pointerAt(e);
          if (!cell) return;
          // A knock when the click cannot work: locked land, or a build the ore
          // does not cover. Merely-occupied cells stay silent, since drags often
          // start on them.
          const snap = getLatest();
          const tool = getSelectedTool();
          if (snap && (!cellUnlocked(snap, cell) || (tool.id !== "destroy" && (tool.cost ?? 0) > spendableOre()))) {
            sfx.deny();
          }
          target.current = cell;
          setHover(cell, spot);
          strokeAnchor.current = cell;
          const startsOnStructure = tool.id === "belt" && snap && kindAt(snap, cell) !== "empty";
          stroke.current = startsOnStructure ? [] : [cell];
          if (tool.id === "belt") showBeltPreview(stroke.current);
        }}
        onPointerMove={(e) => {
          const { cell, spot } = pointerAt(e);
          target.current = cell;
          setHover(cell, spot);
          // Aim the arrow by how the cursor moves, fine enough to update within
          // one cell. Re-aim once it has moved a small step so it tracks the
          // mouse without jittering on tiny moves; Shift holds the aim still.
          const from = aimFrom.current;
          if (!from) {
            aimFrom.current = { x: e.point.x, z: e.point.z };
          } else {
            const dx = e.point.x - from.x;
            const dz = e.point.z - from.z;
            if (Math.hypot(dx, dz) > AIM_STEP) {
              if (!shiftLock.current) setFacing(dirFromDelta(dx, dz));
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
          setHover(null);
        }}
      >
        <planeGeometry args={[1000, 1000]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      <BeltStrokePreview placements={preview} valid={canPlaceBeltStroke(preview)} snap={latest} />

      {/* Soft glow tile previewing an empty target cell. */}
      <group ref={group} visible={false}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, TILE_Y, 0]} scale={[TILE, TILE, 1]} raycast={() => null}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            ref={tileMat}
            color={ACCENT}
            transparent
            opacity={0}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      </group>

      {/* Build-direction arrow: the same chevron the flow uses. */}
      <mesh ref={arrow} geometry={arrowGeo} visible={false} raycast={() => null}>
        <meshBasicMaterial ref={arrowMat} color={ACCENT} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
    </>
  );
}
