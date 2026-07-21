import { useEffect, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import { PiTrashFill } from "react-icons/pi";
import { TOOLS, getSelectedId, selectTool, subscribe } from "./tools";
import { getStats, spendableCredits, subscribeStats } from "../world/economy";
import { tile, ACCENT, CREDIT_TEXT, isTyping } from "../ui";
import { sfx } from "../sfx";

const THUMBS: Record<string, string> = {
  belt: "/models/thumbs/belt.png",
  extractor: "/models/thumbs/extractor.png",
  seller: "/models/thumbs/seller.png",
  refiner: "/models/thumbs/refiner.png",
};

// Toolbar is the build hotbar along the bottom. Placeable tools show Kenney
// model thumbs so the hotbar matches the world; destroy keeps an icon.
export function Toolbar() {
  const selectedId = useSyncExternalStore(subscribe, getSelectedId);
  useSyncExternalStore(subscribeStats, getStats);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || isTyping(e)) return;
      const tool = TOOLS.find((t) => t.hotkey === e.key);
      if (tool) {
        selectTool(tool.id);
        sfx.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="hud-toolbar">
      {TOOLS.map((tool) => {
        const selected = tool.id === selectedId;
        const affordable = (tool.cost ?? 0) <= spendableCredits();
        const thumb = THUMBS[tool.id];
        return (
          <button
            key={tool.id}
            onClick={() => {
              selectTool(tool.id);
              sfx.select();
            }}
            aria-pressed={selected}
            title={`${tool.label} (${tool.hotkey})${tool.cost ? ` · ${tool.cost} credits` : ""}`}
            style={{
              ...tile,
              ...(!affordable && { opacity: 0.45 }),
              ...(selected && {
                border: `1px solid ${ACCENT}`,
                background: "rgba(43, 60, 92, 0.92)",
                color: "#ffffff",
                transform: "translateY(-3px)",
                boxShadow: `0 6px 18px ${ACCENT}55`,
              }),
            }}
          >
            <span style={hotkeyBadge}>{tool.hotkey}</span>
            {tool.cost && <span style={costBadge}>{tool.cost}</span>}
            {thumb ? (
              <img src={thumb} alt="" width={34} height={34} style={thumbStyle} draggable={false} />
            ) : (
              <PiTrashFill size={26} />
            )}
            <span>{tool.label}</span>
          </button>
        );
      })}
    </div>
  );
}

const hotkeyBadge: CSSProperties = {
  position: "absolute",
  top: 4,
  left: 7,
  fontSize: 9,
  opacity: 0.45,
};

const costBadge: CSSProperties = {
  position: "absolute",
  top: 4,
  right: 7,
  fontSize: 9,
  fontWeight: 800,
  color: CREDIT_TEXT,
};

const thumbStyle: CSSProperties = {
  objectFit: "contain",
  filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.45))",
  pointerEvents: "none",
};
