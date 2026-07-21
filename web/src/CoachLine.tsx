import { useEffect, useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import { getStats, subscribeStats } from "./world/economy";
import { coachDismissed, dismissCoach } from "./world/feedback";
import { panel, ACCENT, FONT_DISPLAY, FONT_UI } from "./ui";

// CoachLine is a one-shot tip for empty rooms. It hides after the first income
// tick or when dismissed, and stays gone across reloads.
export function CoachLine() {
  const stats = useSyncExternalStore(subscribeStats, getStats);
  const [visible, setVisible] = useState(() => !coachDismissed());

  useEffect(() => {
    if (!visible) return;
    if (stats.ratePerSec > 0) {
      dismissCoach();
      setVisible(false);
    }
  }, [stats.ratePerSec, visible]);

  if (!visible) return null;

  return (
    <div className="hud-coach" style={wrap} role="status">
      <div style={copy}>
        <div style={title}>Ship raw, or refine for 3×</div>
        <div style={body}>Extractor → belt → seller pays. Route through a refiner for higher-value products.</div>
      </div>
      <button
        type="button"
        style={dismiss}
        onClick={() => {
          dismissCoach();
          setVisible(false);
        }}
        aria-label="Dismiss tip"
      >
        Got it
      </button>
    </div>
  );
}

const wrap: CSSProperties = {
  ...panel,
  position: "absolute",
  left: "50%",
  bottom: "calc(var(--hud-edge) + var(--hud-button-size) + 14px)",
  transform: "translateX(-50%)",
  display: "flex",
  alignItems: "center",
  gap: 14,
  maxWidth: "min(420px, calc(100vw - 40px))",
  padding: "12px 14px",
  pointerEvents: "auto",
};

const copy: CSSProperties = { flex: 1, minWidth: 0 };
const title: CSSProperties = {
  fontFamily: FONT_DISPLAY,
  fontSize: 14,
  fontWeight: 800,
  color: "#f4f6fa",
};
const body: CSSProperties = {
  marginTop: 3,
  fontFamily: FONT_UI,
  fontSize: 12,
  lineHeight: 1.35,
  opacity: 0.72,
};
const dismiss: CSSProperties = {
  flexShrink: 0,
  border: `1px solid ${ACCENT}`,
  background: "rgba(43, 60, 92, 0.75)",
  color: "#fff",
  borderRadius: 8,
  padding: "8px 12px",
  fontFamily: FONT_UI,
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};
