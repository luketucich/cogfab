import { useEffect, useState, useSyncExternalStore } from "react";
import { getStats, subscribeStats } from "./world/economy";
import { panel, FONT_DISPLAY } from "./ui";

// OreCounter is the centred resource readout at the top: an "Iron Ore" header with
// the total counting up below it, and the per-second delivery rate. Only ore that
// reached a seller is counted.
export function OreCounter() {
  const amount = useSmoothOre();
  const rate = useSyncExternalStore(subscribeStats, () => getStats().ratePerSec);

  return (
    <div style={{ ...panel, top: 14, left: "50%", transform: "translateX(-50%)", padding: "10px 26px", textAlign: "center" }}>
      <div style={label}>
        <span style={oreIcon} />
        Iron Ore
      </div>
      <div style={count}>{amount.toLocaleString()}</div>
      <div style={perSec}>+{rate}/s</div>
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
      // Predict at most ~2s ahead, so a dropped connection cannot run the count away.
      const elapsed = s.receivedAt ? Math.min((performance.now() - s.receivedAt) / 1000, 2) : 0;
      const shown = Math.floor(s.ironOre + s.ratePerSec * elapsed);
      setAmount((prev) => (prev === shown ? prev : shown));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return amount;
}

const label: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  fontSize: 11,
  letterSpacing: 1.5,
  textTransform: "uppercase",
  opacity: 0.7,
};

const count: React.CSSProperties = {
  fontFamily: FONT_DISPLAY,
  fontSize: 30,
  fontWeight: 800,
  lineHeight: 1.15,
  color: "#f4f6fa",
};

const perSec: React.CSSProperties = { fontSize: 12, color: "#8fe39a", marginTop: 1 };

// A small metallic chunk standing in for iron ore, matched to the in-world colour.
const oreIcon: React.CSSProperties = {
  width: 14,
  height: 14,
  borderRadius: 4,
  background: "linear-gradient(135deg, #9a9189, #5c554e)",
  border: "1px solid rgba(0, 0, 0, 0.35)",
  boxShadow: "inset 0 1px 1px rgba(255, 255, 255, 0.25)",
};
