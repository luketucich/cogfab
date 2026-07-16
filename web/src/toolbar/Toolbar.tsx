import { useEffect, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import type { IconType } from "react-icons";
import { PiCaretDoubleRightFill, PiShovelFill, PiStorefrontFill, PiTrashFill } from "react-icons/pi";
import { TOOLS, getSelectedId, selectTool, subscribe } from "./tools";
import { getStats, spendableOre, subscribeStats } from "../world/economy";
import { tile, ACCENT, ORE_TEXT, isTyping } from "../ui";
import { sfx } from "../sfx";

// One icon per tool, keyed by id.
const ICONS: Record<string, IconType> = {
  belt: PiCaretDoubleRightFill,
  extractor: PiShovelFill,
  seller: PiStorefrontFill,
  destroy: PiTrashFill,
};

// Toolbar is the build hotbar along the bottom: a tile per tool with its icon,
// label, and number key. Click a tile or press its number to select it; the
// selected tool is what Ground places when you click a cell.
export function Toolbar() {
  const selectedId = useSyncExternalStore(subscribe, getSelectedId);
  useSyncExternalStore(subscribeStats, getStats); // re-render when the ore moves

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
        const Icon = ICONS[tool.id];
        const selected = tool.id === selectedId;
        const affordable = (tool.cost ?? 0) <= spendableOre();
        return (
          <button
            key={tool.id}
            onClick={() => {
              selectTool(tool.id);
              sfx.select();
            }}
            aria-pressed={selected}
            title={`${tool.label} (${tool.hotkey})${tool.cost ? ` · ${tool.cost} ore` : ""}`}
            style={{
              ...tile,
              ...(!affordable && { opacity: 0.45 }), // too pricey right now
              // base tile is the unselected look; only override when selected
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
            <Icon size={26} />
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
  color: ORE_TEXT,
};
