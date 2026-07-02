import { useEffect, useSyncExternalStore } from "react";
import type { IconType } from "react-icons";
import { PiCaretDoubleRightFill, PiShovelFill, PiStorefrontFill, PiTrashFill } from "react-icons/pi";
import { TOOLS, getSelectedId, selectTool, subscribe } from "./tools";
import { tile, ACCENT } from "../ui";

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tool = TOOLS.find((t) => t.hotkey === e.key);
      if (tool) selectTool(tool.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div style={{ position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 8 }}>
      {TOOLS.map((tool) => {
        const Icon = ICONS[tool.id];
        const selected = tool.id === selectedId;
        return (
          <button
            key={tool.id}
            onClick={() => selectTool(tool.id)}
            aria-pressed={selected}
            title={`${tool.label} (${tool.hotkey})`}
            style={{
              ...tile,
              // base tile is the unselected look; only override when selected
              ...(selected && {
                borderColor: ACCENT,
                background: "rgba(43, 60, 92, 0.92)",
                color: "#ffffff",
                transform: "translateY(-3px)",
                boxShadow: `0 6px 18px ${ACCENT}55`,
              }),
            }}
          >
            <span style={hotkeyBadge}>{tool.hotkey}</span>
            <Icon size={26} />
            <span>{tool.label}</span>
          </button>
        );
      })}
    </div>
  );
}

const hotkeyBadge: React.CSSProperties = {
  position: "absolute",
  top: 4,
  left: 7,
  fontSize: 9,
  opacity: 0.45,
};
