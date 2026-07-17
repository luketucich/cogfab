import { useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import type { IconType } from "react-icons";
import { PiShovelFill, PiFastForwardFill, PiCoinsFill, PiArrowsOutFill } from "react-icons/pi";
import {
  beltMultiplier,
  creditsAfterReserve,
  emissionMultiplier,
  fmtNum,
  getStats,
  saleMultiplier,
  spendableCredits,
  subscribeStats,
} from "./world/economy";
import { connection } from "./net/connection";
import { sfx } from "./sfx";
import { panel, ACCENT, CREDIT_TEXT, FONT_DISPLAY, FONT_UI } from "./ui";

function upgradeDetail(current: number, next: number, cost: number, label: string): string {
  const currentValue = `x${fmtNum(current)}`;
  return cost > 0 ? `${currentValue} to x${fmtNum(next)} ${label}` : `${currentValue} ${label}`;
}

function unavailableReason(hasRequiredIncome: boolean, reserveBlocks: boolean): string {
  if (!hasRequiredIncome) return "Connect an active production line first";
  if (reserveBlocks) return "Credits are being kept for the next land unlock";
  return "Not enough credits";
}

// UpgradePanel is the upgrades sidebar in the top right: four live purchases,
// each card spelling out exactly what the next level buys.
export function UpgradePanel() {
  const stats = useSyncExternalStore(subscribeStats, getStats);
  // Production upgrades require a live route and leave the next land purchase
  // untouched. Land itself can still be unlocked after a deposit runs dry.
  const incomeAvailable = stats.ratePerSec > 0;
  const credits = spendableCredits();
  const { extractorLevel: el, beltLevel: bl, valueLevel: vl } = stats;

  return (
    <div className="hud-upgrades" style={panel}>
      <div style={heading}>Upgrades</div>
      <div className="hud-upgrades__list">
        <UpgradeCard
          icon={PiShovelFill}
          name="Extractor Rate"
          detail={upgradeDetail(emissionMultiplier(el), emissionMultiplier(el + 1), stats.extractorCost, "output")}
          tag={`LV ${el}`}
          cost={stats.extractorCost}
          credits={credits}
          incomeAvailable={incomeAvailable}
          reservedCredits={stats.gridCost}
          onBuy={() => {
            sfx.buy();
            connection.send({ type: "buy", upgrade: "extractorRate" });
          }}
        />
        <UpgradeCard
          icon={PiFastForwardFill}
          name="Belt Speed"
          detail={upgradeDetail(beltMultiplier(bl), beltMultiplier(bl + 1), stats.beltCost, "throughput")}
          tag={`LV ${bl}`}
          cost={stats.beltCost}
          credits={credits}
          incomeAvailable={incomeAvailable}
          reservedCredits={stats.gridCost}
          onBuy={() => {
            sfx.buy();
            connection.send({ type: "buy", upgrade: "beltSpeed" });
          }}
        />
        <UpgradeCard
          icon={PiCoinsFill}
          name="Sale Value"
          detail={upgradeDetail(saleMultiplier(vl), saleMultiplier(vl + 1), stats.valueCost, "resource value")}
          tag={`LV ${vl}`}
          cost={stats.valueCost}
          credits={credits}
          incomeAvailable={incomeAvailable}
          reservedCredits={stats.gridCost}
          onBuy={() => {
            sfx.buy();
            connection.send({ type: "buy", upgrade: "oreValue" });
          }}
        />
        <UpgradeCard
          icon={PiArrowsOutFill}
          name="Grid Size"
          detail={
            stats.gridCost > 0
              ? `${stats.gridWidth}x${stats.gridHeight} to ${stats.nextGridWidth}x${stats.nextGridHeight} land`
              : "The whole world is yours"
          }
          tag={`${stats.gridWidth}x${stats.gridHeight}`}
          cost={stats.gridCost}
          credits={credits}
          incomeAvailable={incomeAvailable}
          requiresIncome={false}
          onBuy={() => {
            sfx.expand();
            connection.send({ type: "buy", upgrade: "gridSize" });
          }}
        />
      </div>
    </div>
  );
}

type CardProps = {
  icon: IconType;
  name: string;
  detail: string;
  tag: string; // current level or size, shown beside the name
  cost: number; // next purchase price; 0 = maxed out
  credits: number;
  incomeAvailable: boolean;
  requiresIncome?: boolean;
  reservedCredits?: number;
  onBuy: () => void;
};

function UpgradeCard({
  icon: Icon,
  name,
  detail,
  tag,
  cost,
  credits,
  incomeAvailable,
  requiresIncome = true,
  reservedCredits = 0,
  onBuy,
}: CardProps) {
  const hasRequiredIncome = !requiresIncome || incomeAvailable;
  const availableCredits = creditsAfterReserve(credits, reservedCredits);
  const buyable = cost > 0 && cost <= availableCredits && hasRequiredIncome;
  const reserveBlocks = hasRequiredIncome && cost <= credits && cost > availableCredits;
  const disabledTitle = unavailableReason(hasRequiredIncome, reserveBlocks);
  return (
    <div className="hud-upgrade-card" style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Icon size={24} color={ACCENT} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>
            {name} <span style={tagChip}>{tag}</span>
          </div>
          <div style={{ fontSize: 10, opacity: 0.6, marginTop: 2 }}>{detail}</div>
        </div>
      </div>
      {cost === 0 ? (
        <div style={mutedTag}>Max</div>
      ) : (
        <button
          onClick={onBuy}
          disabled={!buyable}
          title={buyable ? undefined : disabledTitle}
          style={{ ...buyButton, ...(!buyable && { opacity: 0.45, cursor: "default" }) }}
        >
          Upgrade <span style={{ color: CREDIT_TEXT }}>· {fmtNum(cost)} credits</span>
        </button>
      )}
    </div>
  );
}

const heading: CSSProperties = {
  fontFamily: FONT_DISPLAY,
  fontSize: 16,
  fontWeight: 800,
  letterSpacing: 0.5,
};

const card: CSSProperties = {
  padding: 12,
  borderRadius: 10,
  background: "rgba(0, 0, 0, 0.22)",
  border: "1px solid rgba(255, 255, 255, 0.06)",
};

const tagChip: CSSProperties = {
  marginLeft: 4,
  fontSize: 9,
  fontWeight: 800,
  letterSpacing: 0.5,
  color: ACCENT,
};

const buyButton: CSSProperties = {
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

const mutedTag: CSSProperties = {
  marginTop: 11,
  textAlign: "center",
  fontSize: 11,
  letterSpacing: 1,
  textTransform: "uppercase",
  opacity: 0.55,
};
