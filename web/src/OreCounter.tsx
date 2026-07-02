import { useEffect, useState, useSyncExternalStore } from "react";
import { getStats, subscribeStats } from "./world/economy";
import { panel, FONT_DISPLAY } from "./ui";

// OreCounter is the centred resource readout at the top, two matched lines: the
// iron-ore total counting up with its per-second rate, then the size of the
// unlocked grid. Only ore that reached a seller is counted.
export function OreCounter() {
  const amount = useSmoothOre();
  const stats = useSyncExternalStore(subscribeStats, getStats);

  return (
    <div style={{ ...panel, top: 14, left: "50%", transform: "translateX(-50%)", padding: "12px 24px", textAlign: "center" }}>
      <div style={oreRow} title="Iron ore">
        <span style={oreIcon} />
        <span style={count}>{amount.toLocaleString()}</span>
        <span style={perSec}>+{stats.ratePerSec}/s</span>
      </div>
      <div style={gridLabel}>
        Grid {stats.gridWidth}x{stats.gridHeight}
      </div>
    </div>
  );
}

// useSmoothOre counts the total up smoothly between the ~1/sec server updates,
// predicting from the last value and the rate.
function useSmoothOre(): number {
  const [amount, setAmount] = useState(0);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const s = getStats();
      // Predict just past the next server tick, so the count never runs far
      // ahead of the total the buy buttons check against.
      const elapsed = s.receivedAt ? Math.min((performance.now() - s.receivedAt) / 1000, 1.2) : 0;
      const shown = Math.floor(s.ironOre + s.ratePerSec * elapsed);
      setAmount((prev) => (prev === shown ? prev : shown));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return amount;
}

const oreRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 9,
};

const count: React.CSSProperties = {
  fontFamily: FONT_DISPLAY,
  fontSize: 28,
  fontWeight: 800,
  lineHeight: 1.1,
  color: "#f4f6fa",
};

const perSec: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: "#8fe39a" };

const gridLabel: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: 1.5,
  textTransform: "uppercase",
  opacity: 0.55,
  marginTop: 3,
};

// A small metallic chunk standing in for iron ore, matched to the in-world colour.
const oreIcon: React.CSSProperties = {
  width: 14,
  height: 14,
  borderRadius: 4,
  background: "linear-gradient(135deg, #9a9189, #5c554e)",
  border: "1px solid rgba(0, 0, 0, 0.35)",
  boxShadow: "inset 0 1px 1px rgba(255, 255, 255, 0.25)",
};
