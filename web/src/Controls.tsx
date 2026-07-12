import { useState } from "react";
import type { CSSProperties } from "react";
import { panel, tile, FONT_DISPLAY } from "./ui";
import { sfx } from "./sfx";

// Keep this list in step with the bindings in Ground.tsx, CameraRig.tsx,
// Scene.tsx, and the hotkeys in toolbar/tools.ts.
const CONTROLS: [string, string][] = [
  ["Drag", "Lay belts facing the way you drag"],
  ["Right drag", "Pan the camera"],
  ["Scroll", "Zoom at the cursor"],
  ["Q / E", "Spin the camera"],
  ["R", "Rotate what you hover, or your aim"],
  ["Shift", "Lock the placement direction"],
  ["1 - 4", "Pick a tool"],
];

// Controls is the little help button in the bottom left: click it and a small
// sheet unfolds with the main keyboard and mouse controls.
export function Controls() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "absolute", left: 20, bottom: 20, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
      {open && (
        <div style={sheet}>
          {CONTROLS.map(([keys, does]) => (
            <div key={keys} style={row}>
              <span style={kbd}>{keys}</span>
              <span style={what}>{does}</span>
            </div>
          ))}
        </div>
      )}
      <button
        onClick={() => {
          setOpen((v) => !v);
          sfx.select();
        }}
        title="Controls"
        aria-expanded={open}
        style={{ ...tile, width: 44, height: 44, fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 800 }}
      >
        ?
      </button>
    </div>
  );
}

const sheet: CSSProperties = {
  ...panel,
  position: "static",
  padding: 13,
  display: "flex",
  flexDirection: "column",
  gap: 7,
};

const row: CSSProperties = { display: "flex", alignItems: "center", gap: 10 };

const kbd: CSSProperties = {
  minWidth: 70,
  textAlign: "center",
  fontSize: 10,
  fontWeight: 800,
  padding: "3px 7px",
  borderRadius: 6,
  border: "1px solid #3a414e",
  background: "rgba(0, 0, 0, 0.3)",
  color: "#cdd3dc",
  whiteSpace: "nowrap",
};

const what: CSSProperties = { fontSize: 11, opacity: 0.75 };
