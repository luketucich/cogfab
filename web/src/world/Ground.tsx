import { useEffect, useRef, useSyncExternalStore } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { connection } from "../net/connection";
import type { BuildPreview, PlaceableKind, Placement, StateMessage } from "../net/types";
import { sfx } from "../sfx";
import {
  getFacing,
  getSelectedId,
  getSelectedTool,
  rotateFacing,
  setFacing,
  subscribe as subscribeTools,
} from "../toolbar/tools";
import { isTyping } from "../ui";
import { extendBuildStroke, strokePlacements } from "./buildStroke";
import { setBuildPreview } from "./buildPreviewStore";
import { addBurst } from "./burst";
import { getStats, spendableCredits } from "./economy";
import { clockwise } from "./dir";
import {
  cellFromWorld,
  cellIndex,
  cellOffsets,
  cellsBetween,
  dirFromDelta,
  isUnlocked,
  unlockedRect,
  type Cell,
} from "./grid";
import { getHover, setHover } from "./hover";
import { getTerrain, subscribeResources } from "./store";
import { placementTerrainAllows } from "./resources";
import { showPlacementFeedback } from "./placementFeedback";

const AIM_STEP = 0.15; // cursor distance (in cells) before placement direction changes

const tileAt = (snap: StateMessage, cell: Cell) => snap.tiles[cellIndex(snap, cell.x, cell.y)];
const kindAt = (snap: StateMessage, cell: Cell) => tileAt(snap, cell).kind;
const cellUnlocked = (snap: StateMessage, cell: Cell) => {
  const stats = getStats();
  return isUnlocked(unlockedRect(snap, stats.gridWidth, stats.gridHeight), cell.x, cell.y);
};

function placeableKind(id: string): PlaceableKind | null {
  if (id === "belt" || id === "extractor" || id === "seller" || id === "refiner") return id;
  return null;
}

// Ground is the invisible input plane for building. It shares logical build
// previews as the pointer changes, while the server remains authoritative over
// every placement that follows.
export function Ground() {
  const target = useRef<Cell | null>(null);
  const stroke = useRef<Cell[] | null>(null);
  const strokeKind = useRef<PlaceableKind | null>(null);
  const strokeCost = useRef(0);
  const strokeAnchor = useRef<Cell | null>(null); // occupied start used only to aim the first new building
  const aimFrom = useRef<{ x: number; z: number } | null>(null);
  const shiftLock = useRef(false);
  const terrain = useSyncExternalStore(subscribeResources, getTerrain);
  const selectedID = useSyncExternalStore(subscribeTools, getSelectedId);

  function pointerAt(e: ThreeEvent<PointerEvent>): { cell: Cell | null; spot?: { x: number; y: number } } {
    const snap = getTerrain();
    if (!snap) return { cell: null };
    const { offX, offZ } = cellOffsets(snap);
    return {
      cell: cellFromWorld(e.point.x, e.point.z, snap),
      spot: { x: e.point.x + offX, y: e.point.z + offZ },
    };
  }

  function hoverPreview(cell: Cell | null): BuildPreview | null {
    const snap = getTerrain();
    const kind = placeableKind(getSelectedId());
    if (
      !snap ||
      !cell ||
      !kind ||
      !cellUnlocked(snap, cell) ||
      kindAt(snap, cell) !== "empty" ||
      !placementTerrainAllows(snap, kind, cell.x, cell.y)
    )
      return null;
    return { kind, placements: [{ ...cell, dir: getFacing() }] };
  }

  function showHoverPreview(cell = target.current) {
    setBuildPreview(hoverPreview(cell));
  }

  function showBuildPreview(cells: Cell[]) {
    const kind = strokeKind.current;
    const placements = strokePlacements(cells, getFacing(), shiftLock.current);
    setBuildPreview(kind && placements.length > 0 ? { kind, placements } : null);
  }

  function clearStroke() {
    stroke.current = null;
    strokeKind.current = null;
    strokeCost.current = 0;
    strokeAnchor.current = null;
    setBuildPreview(null);
  }

  function sendDestroy(cell: Cell) {
    const snap = getTerrain();
    if (!snap || !cellUnlocked(snap, cell)) return;
    const tile = tileAt(snap, cell);
    if (tile.kind === "empty") return;
    const sent = connection.sendAction(
      { type: "destroy", x: cell.x, y: cell.y, expectedKind: tile.kind, expectedDir: tile.dir },
      [{ x: cell.x, y: cell.y, kind: "empty", dir: "north" }],
    );
    if (!sent) {
      sfx.deny();
      return;
    }
    const { offX, offZ } = cellOffsets(snap);
    sfx.destroy();
    addBurst({ x: cell.x - offX, z: cell.y - offZ, color: "#8a8f9a", count: 10 });
  }

  function canPlaceBatch(kind: PlaceableKind, placements: Placement[], unitCost: number): boolean {
    const snap = getTerrain();
    return (
      !!snap &&
      placements.length > 0 &&
      placements.length * unitCost <= spendableCredits() &&
      placements.every(
        (cell) =>
          cellUnlocked(snap, cell) &&
          kindAt(snap, cell) === "empty" &&
          placementTerrainAllows(snap, kind, cell.x, cell.y),
      )
    );
  }

  function extendStroke(to: Cell) {
    const cells = stroke.current;
    if (!cells) return;
    const kind = strokeKind.current;
    if (kind) {
      const anchor = strokeAnchor.current;
      let next = cells;
      if (cells.length > 0) next = extendBuildStroke(cells, to);
      else if (anchor) next = extendBuildStroke([anchor], to).slice(1);
      const snap = getTerrain();
      if (snap) {
        const blocked = next.findIndex((cell) => !placementTerrainAllows(snap, kind, cell.x, cell.y));
        if (blocked >= 0) next = next.slice(0, blocked);
      }
      if (anchor && to.x === anchor.x && to.y === anchor.y && snap && kindAt(snap, anchor) !== "empty") next = [];
      const added = next.length - cells.length;
      if (added > 0) sfx.preview(added);
      stroke.current = next;
      showBuildPreview(next);
      return;
    }

    let previous = cells[cells.length - 1];
    for (const step of cellsBetween(previous, to)) {
      sendDestroy(previous);
      cells.push(step);
      previous = step;
    }
    setBuildPreview(null);
  }

  function endStroke() {
    const cells = stroke.current;
    if (!cells) return;
    const kind = strokeKind.current;
    const unitCost = strokeCost.current;
    if (kind) {
      if (cells.length === 0) {
        clearStroke();
        return;
      }
      const placements = strokePlacements(cells, getFacing(), shiftLock.current);
      const valid = canPlaceBatch(kind, placements, unitCost);
      if (!valid) {
        clearStroke();
        sfx.deny();
        return;
      }
      const snap = getTerrain();
      const updates = placements.map((placement) => ({ ...placement, kind }));
      const sent = connection.sendAction({ type: "placeBatch", kind, placements }, updates, placements.length * unitCost);
      clearStroke();
      if (!sent) {
        sfx.deny();
        return;
      }
      if (sent.predicted && snap) showPlacementFeedback(snap, updates);
      return;
    }

    const last = cells[cells.length - 1];
    clearStroke();
    if (last) sendDestroy(last);
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (e.key === "Shift") {
        shiftLock.current = true;
        if (stroke.current && strokeKind.current) showBuildPreview(stroke.current);
        return;
      }
      if (e.repeat || (e.key !== "r" && e.key !== "R")) return;
      const snap = getTerrain();
      const cell = getHover();
      if (snap && cell && cellUnlocked(snap, cell)) {
        const tile = tileAt(snap, cell);
        if (tile.kind !== "empty") {
          const sent = connection.sendAction(
            { type: "rotate", x: cell.x, y: cell.y, expectedKind: tile.kind, expectedDir: tile.dir },
            [{ x: cell.x, y: cell.y, kind: tile.kind, dir: clockwise(tile.dir) }],
          );
          if (sent) sfx.select();
          else sfx.deny();
          return;
        }
      }
      rotateFacing();
      if (stroke.current && strokeKind.current) showBuildPreview(stroke.current);
      else showHoverPreview();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== "Shift") return;
      shiftLock.current = false;
      if (stroke.current && strokeKind.current) showBuildPreview(stroke.current);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.target instanceof HTMLCanvasElement) endStroke();
      else clearStroke();
    };
    const onLeave = () => {
      target.current = null;
      aimFrom.current = null;
      setHover(null);
      clearStroke();
    };
    const onPointerOut = (e: PointerEvent) => {
      if (e.relatedTarget === null) onLeave();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointerout", onPointerOut);
    window.addEventListener("blur", onLeave);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointerout", onPointerOut);
      window.removeEventListener("blur", onLeave);
      setBuildPreview(null);
    };
  }, []);

  useEffect(() => {
    if (!stroke.current) showHoverPreview();
  }, [selectedID, terrain]);

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerDown={(e) => {
        if (e.nativeEvent.button !== 0) return;
        const { cell, spot } = pointerAt(e);
        if (!cell) return;
        const snap = getTerrain();
        const tool = getSelectedTool();
        const kind = placeableKind(tool.id);
        if (
          snap &&
          (!cellUnlocked(snap, cell) ||
            (tool.id !== "destroy" && (tool.cost ?? 0) > spendableCredits()) ||
            (!!kind && kindAt(snap, cell) === "empty" && !placementTerrainAllows(snap, kind, cell.x, cell.y)))
        ) {
          sfx.deny();
        }
        target.current = cell;
        setHover(cell, spot);
        strokeAnchor.current = cell;
        strokeKind.current = kind;
        strokeCost.current = tool.cost ?? 0;
        const startsOnStructure = !!kind && !!snap && kindAt(snap, cell) !== "empty";
        const startsOnInvalidTerrain = !!kind && !!snap && !placementTerrainAllows(snap, kind, cell.x, cell.y);
        stroke.current = startsOnStructure || startsOnInvalidTerrain ? [] : [cell];
        if (kind) showBuildPreview(stroke.current);
        else setBuildPreview(null);
      }}
      onPointerMove={(e) => {
        const { cell, spot } = pointerAt(e);
        target.current = cell;
        setHover(cell, spot);
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

        if (!stroke.current) {
          showHoverPreview(cell);
        } else if (e.nativeEvent.buttons & 1) {
          if (cell) extendStroke(cell);
        } else {
          endStroke();
        }
      }}
      onPointerOut={() => {
        target.current = null;
        aimFrom.current = null;
        setHover(null);
        if (!stroke.current) setBuildPreview(null);
      }}
    >
      <planeGeometry args={[1000, 1000]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}
