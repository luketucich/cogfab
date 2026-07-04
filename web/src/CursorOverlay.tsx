import { useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import { getPresence, subscribePresence } from "./world/presence";
import { getSession, subscribeSession } from "./net/session";
import { playerColor, FONT_UI } from "./ui";

// CursorOverlay draws the other players' mouse cursors over the whole page,
// the way collaborative editors do: a pointer in each player's colour with
// their name riding along. Positions arrive as screen fractions ~20 times a
// second; a short CSS transition glides each cursor between them.
export function CursorOverlay() {
  const players = useSyncExternalStore(subscribePresence, getPresence);
  const session = useSyncExternalStore(subscribeSession, getSession);

  return (
    <div style={layer}>
      {players
        .filter((p) => p.slot !== session.slot && p.on)
        .map((p) => {
          const color = playerColor(p);
          return (
            <div
              key={p.slot}
              style={{
                ...cursor,
                transform: `translate(${(p.sx * 100).toFixed(2)}vw, ${(p.sy * 100).toFixed(2)}vh)`,
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" style={pointer}>
                <path d={POINTER} fill="none" stroke="#14171f" strokeWidth="5" strokeLinejoin="round" />
                <path d={POINTER} fill={color} stroke={color} strokeWidth="2.5" strokeLinejoin="round" />
              </svg>
              <span style={{ ...nameTag, background: color }}>{p.name}</span>
            </div>
          );
        })}
    </div>
  );
}

const layer: CSSProperties = {
  position: "absolute",
  inset: 0,
  overflow: "hidden",
  pointerEvents: "none", // cursors are ghosts: nothing under them is blocked
};

// The pointer is drawn twice: a dark rounded outline underneath, the player's
// colour on top. The fat round-joined strokes are what soften the corners, so
// it reads plump and friendly like the rest of the UI, not like a needle.
const POINTER = "M5.5 3.5 L18.5 11 L12.4 12.6 L9 18.5 Z";

const cursor: CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  transition: "transform 90ms linear", // glide between the ~20Hz updates
  willChange: "transform",
};

const pointer: CSSProperties = {
  display: "block",
  margin: "-3px 0 0 -4px", // put the arrow's tip on the shared spot
};

const nameTag: CSSProperties = {
  position: "absolute",
  top: 16,
  left: 13,
  padding: "2px 9px",
  borderRadius: 999,
  fontFamily: FONT_UI,
  fontSize: 11,
  fontWeight: 800,
  color: "#14171f",
  whiteSpace: "nowrap",
};
