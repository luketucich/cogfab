import { useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import type { IconType } from "react-icons";
import { PiShovelFill, PiFastForwardFill, PiCoinsFill, PiFireFill, PiArrowsOutFill } from "react-icons/pi";
import {
  beltMultiplier,
  creditsAfterReserve,
  emissionMultiplier,
  fmtNum,
  getStats,
  refineTime,
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

function refineDetail(level: number, cost: number): string {
  const current = refineTime(level);
  const next = refineTime(level + 1);
  const fmt = (seconds: number) => `${seconds.toFixed(2).replace(/\.?0+$/, "")}s`;
  return cost > 0 ? `${fmt(current)} to ${fmt(next)} per ore` : `${fmt(current)} per ore`;
}

function unavailableReason(hasRequiredIncome: boolean, reserveBlocks: boolean): string {
  if (!hasRequiredIncome) return "Connect an active production line first";
  if (reserveBlocks) return "Credits are being kept for the next land unlock";
  return "Not enough credits";
}

// UpgradePanel is a compact icon rail that expands a card on hover/focus so the
// first viewport stays clear on shorter screens.
export function UpgradePanel() {
  const stats = useSyncExternalStore(subscribeStats, getStats);
  const incomeAvailable = stats.ratePerSec > 0;
  const credits = spendableCredits();
  const { extractorLevel: el, beltLevel: bl, valueLevel: vl, refinerLevel: rl } = stats;
  const [openId, setOpenId] = useState<string | null>(null);

  const cards: CardProps[] = [
    {
      id: "extractor",
      icon: PiShovelFill,
      name: "Extractor Rate",
      detail: upgradeDetail(emissionMultiplier(el), emissionMultiplier(el + 1), stats.extractorCost, "output"),
      tag: `LV ${el}`,
      cost: stats.extractorCost,
      credits,
      incomeAvailable,
      reservedCredits: stats.gridCost,
      onBuy: () => {
        sfx.buy();
        connection.send({ type: "buy", upgrade: "extractorRate" });
      },
    },
    {
      id: "belt",
      icon: PiFastForwardFill,
      name: "Belt Speed",
      detail: upgradeDetail(beltMultiplier(bl), beltMultiplier(bl + 1), stats.beltCost, "throughput"),
      tag: `LV ${bl}`,
      cost: stats.beltCost,
      credits,
      incomeAvailable,
      reservedCredits: stats.gridCost,
      onBuy: () => {
        sfx.buy();
        connection.send({ type: "buy", upgrade: "beltSpeed" });
      },
    },
    {
      id: "refiner",
      icon: PiFireFill,
      name: "Refiner Speed",
      detail: refineDetail(rl, stats.refinerCost),
      tag: `LV ${rl}`,
      cost: stats.refinerCost,
      credits,
      incomeAvailable,
      reservedCredits: stats.gridCost,
      onBuy: () => {
        sfx.buy();
        connection.send({ type: "buy", upgrade: "refinerSpeed" });
      },
    },
    {
      id: "value",
      icon: PiCoinsFill,
      name: "Sale Value",
      detail: upgradeDetail(saleMultiplier(vl), saleMultiplier(vl + 1), stats.valueCost, "resource value"),
      tag: `LV ${vl}`,
      cost: stats.valueCost,
      credits,
      incomeAvailable,
      reservedCredits: stats.gridCost,
      onBuy: () => {
        sfx.buy();
        connection.send({ type: "buy", upgrade: "oreValue" });
      },
    },
    {
      id: "grid",
      icon: PiArrowsOutFill,
      name: "Grid Size",
      detail:
        stats.gridCost > 0
          ? `${stats.gridWidth}x${stats.gridHeight} to ${stats.nextGridWidth}x${stats.nextGridHeight} land`
          : "The whole world is yours",
      tag: `${stats.gridWidth}x${stats.gridHeight}`,
      cost: stats.gridCost,
      credits,
      incomeAvailable,
      requiresIncome: false,
      onBuy: () => {
        sfx.expand();
        connection.send({ type: "buy", upgrade: "gridSize" });
      },
    },
  ];

  return (
    <div className="hud-upgrades" style={panel}>
      <div style={heading}>Upgrades</div>
      <div className="hud-upgrades__rail">
        {cards.map((card) => {
          const Icon = card.icon;
          const open = openId === card.id;
          const availableCredits = creditsAfterReserve(card.credits, card.reservedCredits ?? 0);
          const hasRequiredIncome = card.requiresIncome === false || card.incomeAvailable;
          const buyable = card.cost > 0 && card.cost <= availableCredits && hasRequiredIncome;
          return (
            <div
              key={card.id}
              className="hud-upgrade-slot"
              onMouseEnter={() => setOpenId(card.id)}
              onMouseLeave={() => setOpenId((id) => (id === card.id ? null : id))}
              onFocus={() => setOpenId(card.id)}
              onBlur={() => setOpenId((id) => (id === card.id ? null : id))}
            >
              <button
                type="button"
                className="hud-upgrade-chip"
                style={{
                  ...chip,
                  ...(open && { borderColor: ACCENT, background: "rgba(43, 60, 92, 0.9)" }),
                  ...(!buyable && card.cost > 0 && { opacity: 0.55 }),
                }}
                title={`${card.name} · ${card.tag}`}
                aria-expanded={open}
              >
                <Icon size={18} color={ACCENT} />
                <span style={chipCost}>{card.cost === 0 ? "Max" : fmtNum(card.cost)}</span>
              </button>
              {open && (
                <div className="hud-upgrade-card" style={cardStyle} role="dialog" aria-label={card.name}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Icon size={22} color={ACCENT} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>
                        {card.name} <span style={tagChip}>{card.tag}</span>
                      </div>
                      <div style={{ fontSize: 10, opacity: 0.6, marginTop: 2 }}>{card.detail}</div>
                    </div>
                  </div>
                  {card.cost === 0 ? (
                    <div style={mutedTag}>Max</div>
                  ) : (
                    <button
                      onClick={card.onBuy}
                      disabled={!buyable}
                      title={
                        buyable
                          ? undefined
                          : unavailableReason(
                              hasRequiredIncome,
                              hasRequiredIncome && card.cost <= card.credits && card.cost > availableCredits,
                            )
                      }
                      style={{ ...buyButton, ...(!buyable && { opacity: 0.45, cursor: "default" }) }}
                    >
                      Upgrade <span style={{ color: CREDIT_TEXT }}>· {fmtNum(card.cost)} credits</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type CardProps = {
  id: string;
  icon: IconType;
  name: string;
  detail: string;
  tag: string;
  cost: number;
  credits: number;
  incomeAvailable: boolean;
  requiresIncome?: boolean;
  reservedCredits?: number;
  onBuy: () => void;
};

const heading: CSSProperties = {
  fontFamily: FONT_DISPLAY,
  fontSize: 14,
  fontWeight: 800,
  letterSpacing: 0.5,
  marginBottom: 10,
};

const chip: CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(0,0,0,0.22)",
  color: "#fff",
  cursor: "default",
  fontFamily: FONT_UI,
};

const chipCost: CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  color: CREDIT_TEXT,
  fontVariantNumeric: "tabular-nums",
};

const cardStyle: CSSProperties = {
  position: "absolute",
  right: "calc(100% + 10px)",
  top: 0,
  width: 210,
  padding: 12,
  borderRadius: 12,
  background: "rgba(18, 21, 28, 0.94)",
  border: "1px solid rgba(255, 255, 255, 0.1)",
  boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
  zIndex: 5,
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
