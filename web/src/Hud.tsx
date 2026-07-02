import { useSyncExternalStore } from "react";
import { useConnection } from "./useConnection";
import { getPing, subscribePing } from "./net/ping";
import { panel, FONT_DISPLAY } from "./ui";

// Hud is the top-left brand panel: the game title and a signal bar showing the
// connection. The bars' strength and colour track the round-trip ping, and the
// ping in milliseconds sits beside them.
export function Hud() {
  const { connected } = useConnection();
  const ping = useSyncExternalStore(subscribePing, getPing);

  return (
    <div style={{ ...panel, top: 14, left: 14, padding: "10px 16px", display: "flex", alignItems: "center", gap: 14 }}>
      <div style={title}>Cogfab.io</div>
      <PingBar connected={connected} ping={ping} />
    </div>
  );
}

const BAR_HEIGHTS = [6, 10, 14, 18];

// signal maps the connection state to how many bars light up and in what colour:
// more bars and greener for a quicker ping, down to one red bar when offline.
function signal(connected: boolean, ping: number | null): { bars: number; color: string } {
  if (!connected) return { bars: 1, color: "#e05260" };
  if (ping === null) return { bars: 2, color: "#9aa3b2" }; // connected, not measured yet
  if (ping < 80) return { bars: 4, color: "#46d369" };
  if (ping < 160) return { bars: 3, color: "#74cf57" };
  if (ping < 300) return { bars: 2, color: "#e0c14f" };
  return { bars: 1, color: "#e0795f" };
}

function PingBar({ connected, ping }: { connected: boolean; ping: number | null }) {
  const { bars, color } = signal(connected, ping);
  const ms = ping === null ? null : Math.round(ping);
  return (
    <div title={connected ? (ms === null ? "connecting" : `${ms}ms`) : "offline"} style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2.5, height: 18 }}>
        {BAR_HEIGHTS.map((h, i) => (
          <span
            key={i}
            style={{
              width: 3.5,
              height: h,
              borderRadius: 1.5,
              background: i < bars ? color : "#39404e",
              transition: "background 250ms",
            }}
          />
        ))}
      </div>
      {connected && ms !== null && <span style={pingText}>{ms}ms</span>}
    </div>
  );
}

const title: React.CSSProperties = {
  fontFamily: FONT_DISPLAY,
  fontSize: 22,
  fontWeight: 800,
  letterSpacing: 0.5,
  color: "#f0f3f8",
};

const pingText: React.CSSProperties = { fontSize: 10, fontWeight: 700, opacity: 0.55 };
