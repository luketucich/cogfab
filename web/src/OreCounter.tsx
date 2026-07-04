import { useEffect, useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import { fmtNum, getStats, subscribeStats } from "./world/economy";
import { panel, FONT_DISPLAY } from "./ui";

// OreCounter is the centred readout at the top: the iron-ore total as the big
// headline, with the rate and grid size tucked on one line beneath. The panel
// keeps a fixed floor width and fixed-width digits so the fast-changing number
// never makes it jitter. Only ore that reached a seller is counted.
export function OreCounter() {
  const amount = useSmoothOre();
  const stats = useSyncExternalStore(subscribeStats, getStats);

  return (
    <div style={{ ...panel, top: 14, left: "50%", transform: "translateX(-50%)", padding: "9px 22px", minWidth: 170, textAlign: "center" }}>
      <div style={statLabel}>Iron Ore</div>
      <div style={count}>{fmtNum(amount)}</div>
      <div style={subRow}>
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

// useSmoothOre counts the total up smoothly between the ~1/sec server updates,
// predicting from the last total and the rate. The display never steps
// backward unless the server total itself dropped (a purchase or a teardown
// refund); a prediction that ran slightly ahead just holds until the real
// total catches up.
function useSmoothOre(): number {
  const [amount, setAmount] = useState(0);

  useEffect(() => {
    let raf = 0;
    let shown = 0;
    let lastServer = 0;
    const tick = () => {
      const s = getStats();
      const elapsed = s.receivedAt ? Math.min((performance.now() - s.receivedAt) / 1000, 1.2) : 0;
      const predicted = Math.floor(s.ironOre + s.ratePerSec * elapsed);
      // With no income the server total is final, so show it exactly; otherwise
      // hold any prediction overshoot until the real total catches up.
      shown = s.ironOre < lastServer || s.ratePerSec === 0 ? predicted : Math.max(predicted, shown);
      lastServer = s.ironOre;
      setAmount((prev) => (prev === shown ? prev : shown));
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
  fontVariantNumeric: "tabular-nums", // every digit the same width: no wobble
};

const subRow: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "center",
  gap: 8,
  marginTop: 2,
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
