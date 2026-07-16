import { useEffect, useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import { fmtNum, getStats, subscribeStats } from "./world/economy";
import { panel, FONT_DISPLAY } from "./ui";

// CreditsCounter is the centred readout at the top: shared credits as the big
// headline, with the current sale rate and grid size beneath it.
export function CreditsCounter() {
  const amount = useSmoothCredits();
  const stats = useSyncExternalStore(subscribeStats, getStats);

  return (
    <div className="hud-credits" style={{ ...panel, textAlign: "center" }}>
      <div style={statLabel}>Credits</div>
      <div style={count}>{fmtNum(amount)}</div>
      <div className="hud-credits__subrow" style={subRow}>
        <span>
          <span style={statLabel}>Rate</span> <span style={rateValue}>+{fmtNum(stats.ratePerSec, 1)}/s</span>
        </span>
        <span style={dot}>·</span>
        <span>
          <span style={statLabel}>Grid</span> <span style={gridValue}>{stats.gridWidth}x{stats.gridHeight}</span>
        </span>
      </div>
    </div>
  );
}

// Count smoothly between server updates without ever spending credits the
// server has not confirmed.
function useSmoothCredits(): number {
  const [amount, setAmount] = useState(0);

  useEffect(() => {
    let raf = 0;
    let shown = 0;
    let lastServer = 0;
    const tick = () => {
      const stats = getStats();
      const elapsed = stats.receivedAt ? Math.min((performance.now() - stats.receivedAt) / 1000, 1.2) : 0;
      const predicted = Math.floor(stats.credits + stats.ratePerSec * elapsed);
      shown = stats.credits < lastServer || stats.ratePerSec === 0 ? predicted : Math.max(predicted, shown);
      lastServer = stats.credits;
      setAmount((previous) => (previous === shown ? previous : shown));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return amount;
}

const statLabel: CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: 1,
  textTransform: "uppercase",
  opacity: 0.45,
};

const count: CSSProperties = {
  fontFamily: FONT_DISPLAY,
  fontSize: 26,
  fontWeight: 800,
  lineHeight: 1.1,
  color: "#f4f6fa",
  fontVariantNumeric: "tabular-nums",
};

const subRow: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "center",
  marginTop: 2,
  whiteSpace: "nowrap",
};

const rateValue: CSSProperties = {
  fontFamily: FONT_DISPLAY,
  fontSize: 13,
  fontWeight: 800,
  color: "#8fe39a",
  fontVariantNumeric: "tabular-nums",
};

const gridValue: CSSProperties = {
  fontFamily: FONT_DISPLAY,
  fontSize: 13,
  fontWeight: 800,
  color: "#cdd3dc",
};

const dot: CSSProperties = { fontSize: 10, opacity: 0.35 };
