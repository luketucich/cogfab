import { useSyncExternalStore } from "react";
import type { IconType } from "react-icons";
import { PiShovelFill, PiFastForwardFill, PiArrowsOutFill } from "react-icons/pi";
import { getStats, spendableOre, subscribeStats } from "./world/economy";
import { connection } from "./net/connection";
import { panel, ACCENT, ORE_TEXT, FONT_DISPLAY, FONT_UI } from "./ui";

// UpgradePanel is the upgrades sidebar in the top right. Extractor Rate and
// Grid Size are live purchases; Belt Speed marks where the next upgrade goes.
export function UpgradePanel() {
  const stats = useSyncExternalStore(subscribeStats, getStats);
  // The server only sells upgrades while ore is flowing (spending with no
  // income could strand the game), so the buttons wait for income too.
  const earning = stats.ratePerSec > 0;

  return (
    <div style={{ ...panel, top: 14, right: 14, width: 196, padding: 16 }}>
      <div style={heading}>Upgrades</div>
      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <UpgradeCard
          icon={PiShovelFill}
          name="Extractor Rate"
          detail="Denser ore from every extractor"
          tag={`LV ${stats.extractorLevel}`}
          cost={stats.extractorCost}
          ironOre={spendableOre()}
          earning={earning}
          onBuy={() => connection.send({ type: "buy", upgrade: "extractorRate" })}
        />
        <UpgradeCard icon={PiFastForwardFill} name="Belt Speed" detail="Quicker belts" locked />
        <UpgradeCard
          icon={PiArrowsOutFill}
          name="Grid Size"
          detail="Unlock more land"
          tag={`${stats.gridWidth}x${stats.gridHeight}`}
          cost={stats.gridCost}
          ironOre={spendableOre()}
          earning={earning}
          onBuy={() => connection.send({ type: "buy", upgrade: "gridSize" })}
        />
      </div>
    </div>
  );
}

type CardProps = {
  icon: IconType;
  name: string;
  detail: string;
  locked?: boolean;
  tag?: string; // current level or size, shown beside the name
  cost?: number; // next purchase price; 0 = maxed out
  ironOre?: number;
  earning?: boolean;
  onBuy?: () => void;
};

function UpgradeCard({ icon: Icon, name, detail, locked, tag, cost = 0, ironOre = 0, earning, onBuy }: CardProps) {
  const buyable = cost > 0 && cost <= ironOre && earning;
  return (
    <div style={{ ...card, ...(locked && { opacity: 0.5 }) }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Icon size={24} color={locked ? "#9aa3b2" : ACCENT} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>
            {name} {tag && <span style={tagChip}>{tag}</span>}
          </div>
          <div style={{ fontSize: 10, opacity: 0.6, marginTop: 2 }}>{detail}</div>
        </div>
      </div>
      {locked ? (
        <div style={mutedTag}>Locked</div>
      ) : cost === 0 ? (
        <div style={mutedTag}>Max</div>
      ) : (
        <button
          onClick={onBuy}
          disabled={!buyable}
          title={earning ? undefined : "Get some ore flowing first"}
          style={{ ...buyButton, ...(!buyable && { opacity: 0.45, cursor: "default" }) }}
        >
          Upgrade <span style={{ color: ORE_TEXT }}>· {cost} ore</span>
        </button>
      )}
    </div>
  );
}

const heading: React.CSSProperties = {
  fontFamily: FONT_DISPLAY,
  fontSize: 16,
  fontWeight: 800,
  letterSpacing: 0.5,
};

const card: React.CSSProperties = {
  padding: 12,
  borderRadius: 10,
  background: "rgba(0, 0, 0, 0.22)",
  border: "1px solid rgba(255, 255, 255, 0.06)",
};

const tagChip: React.CSSProperties = {
  marginLeft: 4,
  fontSize: 9,
  fontWeight: 800,
  letterSpacing: 0.5,
  color: ACCENT,
};

const buyButton: React.CSSProperties = {
  marginTop: 11,
  width: "100%",
  padding: "8px 0",
  borderRadius: 8,
  border: `1px solid ${ACCENT}`,
  background: "rgba(43, 60, 92, 0.7)",
  color: "#fff",
  fontFamily: FONT_UI,
  fontSize: 12,
  cursor: "pointer",
};

const mutedTag: React.CSSProperties = {
  marginTop: 11,
  textAlign: "center",
  fontSize: 11,
  letterSpacing: 1,
  textTransform: "uppercase",
  opacity: 0.55,
};
