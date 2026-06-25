import { useSyncExternalStore } from "react";
import { TOOLS, getSelectedId, selectTool, subscribe } from "./tools";

// Toolbar is the build menu: a row of buttons, one per tool. Clicking one
// selects it, and the selected tool is what Ground sends when you click a cell.
export function Toolbar() {
  const selectedId = useSyncExternalStore(subscribe, getSelectedId);

  return (
    <div
      style={{
        position: "absolute",
        bottom: 20,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        gap: 8,
      }}
    >
      {TOOLS.map((tool) => {
        const selected = tool.id === selectedId;
        return (
          <button
            key={tool.id}
            onClick={() => selectTool(tool.id)}
            aria-pressed={selected}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: `1px solid ${selected ? "#6ea8ff" : "#3a414e"}`,
              background: selected ? "#2b3c5c" : "#1f242e",
              color: "#e6e6e6",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {tool.label}
          </button>
        );
      })}
    </div>
  );
}
