import type { IconType } from "react-icons";
import { PiShovelFill, PiFastForwardFill, PiArrowsOutFill } from "react-icons/pi";
import { panel, FONT_DISPLAY } from "./ui";

// UpgradePanel is the upgrades sidebar in the top right. It is visual only for
// now: every row is locked, showing where future upgrades will go.
export function UpgradePanel() {
  return (
    <div style={{ ...panel, top: 14, right: 14, width: 196, padding: 16 }}>
      <div style={heading}>Upgrades</div>
      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <UpgradeCard icon={PiShovelFill} name="Extractor Rate" detail="Faster mining" />
        <UpgradeCard icon={PiFastForwardFill} name="Belt Speed" detail="Quicker belts" />
        <UpgradeCard icon={PiArrowsOutFill} name="Grid Size" detail="More room" />
      </div>
    </div>
  );
}

type CardProps = {
  icon: IconType;
  name: string;
  detail: string;
};

function UpgradeCard({ icon: Icon, name, detail }: CardProps) {
  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Icon size={24} color="#9aa3b2" />
        <div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{name}</div>
          <div style={{ fontSize: 10, opacity: 0.6, marginTop: 2 }}>{detail}</div>
        </div>
      </div>
      <div style={lockedTag}>Locked</div>
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
  opacity: 0.5,
};

const lockedTag: React.CSSProperties = {
  marginTop: 11,
  textAlign: "center",
  fontSize: 11,
  letterSpacing: 1,
  textTransform: "uppercase",
  opacity: 0.55,
};
