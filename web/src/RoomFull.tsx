import { useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import { getSession, subscribeSession } from "./net/session";
import { panel, FONT_DISPLAY } from "./ui";

// RoomFull covers the screen when the server refuses a join, normally because
// the room has four players, and offers a fresh room.
export function RoomFull() {
  const session = useSyncExternalStore(subscribeSession, getSession);
  if (!session.full) return null;

  return (
    <div style={scrim}>
      <div style={{ ...panel, position: "static", padding: "26px 34px", textAlign: "center" }}>
        <div style={heading}>Room full</div>
        <div style={body}>This room already has its 4 players.</div>
        <button onClick={() => (location.href = location.pathname)} style={freshButton}>
          Start a fresh room
        </button>
      </div>
    </div>
  );
}

const scrim: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(10, 12, 16, 0.7)",
};

const heading: CSSProperties = {
  fontFamily: FONT_DISPLAY,
  fontSize: 22,
  fontWeight: 800,
};

const body: CSSProperties = { fontSize: 13, opacity: 0.75, marginTop: 6 };

const freshButton: CSSProperties = {
  marginTop: 18,
  padding: "10px 22px",
  borderRadius: 10,
  border: "1px solid #6ea8ff",
  background: "rgba(43, 60, 92, 0.85)",
  color: "#fff",
  fontFamily: FONT_DISPLAY,
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};
