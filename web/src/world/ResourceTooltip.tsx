import { useRef } from "react";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import type { CSSProperties } from "react";
import * as THREE from "three";
import { fmtNum, refinerAt, refinerRemaining } from "./economy";
import { cellOffsets } from "./grid";
import { getHover } from "./hover";
import {
  stepTooltipSpring,
  tooltipHorizontalShift,
  tooltipMotion,
  tooltipScale,
  type TooltipSpring,
} from "./overlayScale";
import { depositAt, hasPortAt, refineResource, RESOURCE_PALETTE } from "./resources";
import { getTerrain } from "./store";
import { ACCENT, FONT_DISPLAY, FONT_UI } from "../ui";

// ResourceTooltip explains sparse terrain without routing pointer movement
// through React. Text changes only when the hovered feature changes.
export function ResourceTooltip() {
  const group = useRef<THREE.Group>(null!);
  const panel = useRef<HTMLDivElement>(null!);
  const name = useRef<HTMLDivElement>(null!);
  const instruction = useRef<HTMLDivElement>(null!);
  const amount = useRef<HTMLDivElement>(null!);
  const shown = useRef("");
  const anchor = useRef("");
  const motion = useRef<TooltipSpring>({ value: 0, velocity: 0 });
  const projected = useRef(new THREE.Vector3());

  useFrame(({ camera, size }, delta) => {
    if (!group.current) return;
    const snap = getTerrain();
    const cell = getHover();
    const deposit = snap && cell ? depositAt(snap, cell.x, cell.y) : undefined;
    const port = !!snap && !!cell && hasPortAt(snap, cell.x, cell.y);
    const tileKind = snap && cell ? snap.tiles[cell.y * snap.width + cell.x]?.kind : "empty";
    const isRefiner = tileKind === "refiner";
    const refiner = cell && isRefiner ? refinerAt(cell.x, cell.y) : undefined;
    const visible = !!deposit || port || isRefiner;
    let horizontalShift = 0;
    if (visible && snap && cell) {
      const { offX, offZ } = cellOffsets(snap);
      const worldX = cell.x - offX;
      const worldZ = cell.y - offZ;
      const anchorY =
        tileKind === "extractor"
          ? 1.42
          : tileKind === "seller"
            ? 1.38
            : tileKind === "refiner"
              ? 1.68
              : 1.02;
      group.current.position.set(worldX, anchorY, worldZ);
      if (panel.current) {
        projected.current.set(worldX, anchorY, worldZ).project(camera);
        const anchorX = (projected.current.x * 0.5 + 0.5) * size.width;
        const lobby = document.querySelector<HTMLElement>(".hud-lobby")?.getBoundingClientRect();
        const upgrades = document.querySelector<HTMLElement>(".hud-upgrades")?.getBoundingClientRect();
        horizontalShift = tooltipHorizontalShift(
          anchorX,
          panel.current.offsetWidth,
          lobby?.right ?? 0,
          upgrades?.left ?? size.width,
        );
      }
    }
    const nextAnchor = visible && cell ? `${cell.x}:${cell.y}:${tileKind}` : "";
    if (nextAnchor && anchor.current && nextAnchor !== anchor.current) {
      // Moving directly between machines should still feel like a fresh
      // tooltip, without replaying the whole entrance from zero.
      motion.current = { value: Math.min(motion.current.value, 0.78), velocity: 2.2 };
    }
    anchor.current = nextAnchor;
    motion.current = stepTooltipSpring(motion.current, visible, delta);
    const moving = visible || motion.current.value > 0.001 || Math.abs(motion.current.velocity) > 0.01;
    group.current.visible = moving;
    if (panel.current) {
      panel.current.style.display = moving ? "block" : "none";
      const visual = tooltipMotion(motion.current.value, tooltipScale(camera.zoom));
      panel.current.style.opacity = `${visual.opacity}`;
      // Html centres its child on the world anchor. The spring rises six
      // pixels, settles with a tiny scale overshoot, then eases down on exit.
      panel.current.style.transform =
        `translateX(${horizontalShift}px) translateY(calc(-50% - ${visual.offset}px)) scale(${visual.scale})`;
    }
    if (!snap || !cell || (!deposit && !port && !isRefiner)) return;
    const remainingSeconds = refiner ? refinerRemaining(refiner) : 0;
    const key = isRefiner
      ? `refiner:${refiner?.resource ?? "idle"}:${refiner?.queued ?? 0}:${refiner?.incoming ?? 0}:${Math.ceil(remainingSeconds * 10)}`
      : deposit
        ? `${deposit.kind}:${deposit.remaining}:${deposit.capacity}:${tileKind}`
        : `port:${tileKind}`;
    if (key === shown.current || !name.current || !instruction.current || !amount.current) return;
    shown.current = key;
    if (isRefiner) {
      const processing = refiner?.resource;
      if (processing) {
        const raw = RESOURCE_PALETTE[processing];
        const product = RESOURCE_PALETTE[refineResource(processing)];
        name.current.textContent = `${raw.label} → ${product.label}`;
        name.current.style.color = product.color;
        instruction.current.textContent = remainingSeconds > 0
          ? `Refining · ${remainingSeconds.toFixed(1)}s remaining`
          : "Completing current ore";
      } else {
        name.current.textContent = "Refiner";
        name.current.style.color = ACCENT;
        const pending = (refiner?.queued ?? 0) + (refiner?.incoming ?? 0);
        instruction.current.textContent = pending <= 0
          ? "Waiting for ore"
          : remainingSeconds > 0
            ? `Next output · ${remainingSeconds.toFixed(1)}s`
            : "Ore inbound";
      }
      const queued = refiner?.queued ?? 0;
      const incoming = refiner?.incoming ?? 0;
      amount.current.textContent = processing
        ? `1 processing · ${fmtNum(queued)} waiting`
        : queued > 0
          ? `${fmtNum(queued)} waiting · ${fmtNum(incoming)} inbound`
          : incoming > 0
            ? `${fmtNum(incoming)} ore inbound`
            : "0 processing · 0 waiting";
    } else if (deposit) {
      const style = RESOURCE_PALETTE[deposit.kind];
      name.current.textContent = `${style.label} deposit`;
      name.current.style.color = style.color;
      if (deposit.remaining > 0) {
        instruction.current.textContent = tileKind === "extractor" ? "Extractor installed" : "Place an extractor here";
        const credits = style.baseCredits === 1 ? "credit" : "credits";
        amount.current.textContent = `${fmtNum(deposit.remaining)} left, ${style.baseCredits} base ${credits} each`;
      } else {
        instruction.current.textContent = "Deposit depleted";
        amount.current.textContent = tileKind === "extractor" ? "Remove the extractor to reuse this tile" : "Belts can cross this tile";
      }
    } else {
      name.current.textContent = "Shipping port";
      name.current.style.color = ACCENT;
      instruction.current.textContent = tileKind === "seller" ? "Seller installed" : "Place a seller here";
      amount.current.textContent = "";
    }
  });

  return (
    <group ref={group} visible={false}>
      <Html center style={{ pointerEvents: "none" }}>
        <div ref={panel} style={tooltip}>
          <div ref={name} style={resourceName} />
          <div ref={instruction} style={placementHint} />
          <div ref={amount} style={remaining} />
        </div>
      </Html>
    </group>
  );
}

const tooltip: CSSProperties = {
  display: "none",
  minWidth: 158,
  padding: "8px 11px",
  border: "1px solid rgba(255, 255, 255, 0.12)",
  borderRadius: 9,
  background: "rgba(18, 21, 28, 0.94)",
  boxShadow: "0 6px 18px rgba(0, 0, 0, 0.36)",
  textAlign: "center",
  whiteSpace: "nowrap",
  transformOrigin: "center bottom",
  willChange: "transform, opacity",
};

const resourceName: CSSProperties = {
  fontFamily: FONT_DISPLAY,
  fontSize: 13,
  fontWeight: 800,
  lineHeight: 1.15,
};

const placementHint: CSSProperties = {
  marginTop: 2,
  color: "#f1f3f7",
  fontFamily: FONT_UI,
  fontSize: 10,
  fontWeight: 700,
  lineHeight: 1.2,
};

const remaining: CSSProperties = {
  marginTop: 1,
  color: "#e6e6e6",
  fontFamily: FONT_UI,
  fontSize: 10,
  fontWeight: 700,
  lineHeight: 1.2,
  opacity: 0.75,
};
