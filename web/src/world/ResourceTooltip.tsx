import { useRef } from "react";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import type { CSSProperties } from "react";
import * as THREE from "three";
import { fmtNum } from "./economy";
import { cellOffsets } from "./grid";
import { getHover } from "./hover";
import { depositAt, hasPortAt, RESOURCE_PALETTE } from "./resources";
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

  useFrame(() => {
    if (!group.current) return;
    const snap = getTerrain();
    const cell = getHover();
    const deposit = snap && cell ? depositAt(snap, cell.x, cell.y) : undefined;
    const port = !!snap && !!cell && hasPortAt(snap, cell.x, cell.y);
    const tileKind = snap && cell ? snap.tiles[cell.y * snap.width + cell.x]?.kind : "empty";
    const visible = !!deposit || port;
    group.current.visible = visible;
    if (panel.current) panel.current.style.display = visible ? "block" : "none";
    if (!snap || !cell || (!deposit && !port)) return;
    const { offX, offZ } = cellOffsets(snap);
    group.current.position.set(cell.x - offX, 0.95, cell.y - offZ);
    const key = deposit ? `${deposit.kind}:${deposit.remaining}:${deposit.capacity}:${tileKind}` : `port:${tileKind}`;
    if (key === shown.current || !name.current || !instruction.current || !amount.current) return;
    shown.current = key;
    if (deposit) {
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
  minWidth: 104,
  padding: "7px 9px",
  border: "1px solid rgba(255, 255, 255, 0.12)",
  borderRadius: 8,
  background: "rgba(18, 21, 28, 0.9)",
  boxShadow: "0 5px 16px rgba(0, 0, 0, 0.3)",
  textAlign: "center",
  whiteSpace: "nowrap",
};

const resourceName: CSSProperties = {
  fontFamily: FONT_DISPLAY,
  fontSize: 12,
  fontWeight: 800,
};

const placementHint: CSSProperties = {
  marginTop: 2,
  color: "#f1f3f7",
  fontFamily: FONT_UI,
  fontSize: 9,
  fontWeight: 700,
};

const remaining: CSSProperties = {
  marginTop: 1,
  color: "#e6e6e6",
  fontFamily: FONT_UI,
  fontSize: 9,
  fontWeight: 700,
  opacity: 0.75,
};
