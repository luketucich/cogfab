import { useState, useSyncExternalStore } from "react";
import { PiCheckBold, PiCopyFill } from "react-icons/pi";
import { useConnection } from "./useConnection";
import { getPing, subscribePing } from "./net/ping";
import { getSession, subscribeSession } from "./net/session";
import { getPresence, subscribePresence } from "./world/presence";
import { sfx } from "./sfx";
import { panel, FONT_DISPLAY, PLAYER_COLORS } from "./ui";

// Hud is the top-left brand panel: the game title, a signal bar showing the
// connection, and the room: its code (with a copy-the-invite button, since the
// page URL is the invite) and one colored dot per player, yours ringed.
export function Hud() {
  const { connected } = useConnection();
  const ping = useSyncExternalStore(subscribePing, getPing);
  const session = useSyncExternalStore(subscribeSession, getSession);
  const players = useSyncExternalStore(subscribePresence, getPresence);

  return (
    <div style={{ ...panel, top: 14, left: 14, padding: "10px 16px", display: "flex", alignItems: "center", gap: 14 }}>
      <div style={title}>Cogfab.io</div>
      <PingBar connected={connected} ping={ping} />
      {session.room && (
        <>
          <div style={dividerLine} />
          <RoomBadge code={session.room} slots={players.map((p) => p.slot)} mySlot={session.slot} />
        </>
      )}
    </div>
  );
}

// RoomBadge shows the room code, a copy-invite-link button, and who is here.
function RoomBadge({ code, slots, mySlot }: { code: string; slots: number[]; mySlot: number }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(location.href);
    sfx.select();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={roomCode}>{code}</span>
      <button onClick={copy} title="Copy the invite link" style={copyButton}>
        {copied ? <PiCheckBold size={13} color="#5fd47a" /> : <PiCopyFill size={13} />}
      </button>
      <div style={{ display: "flex", gap: 4 }}>
        {slots.map((slot) => (
          <span
            key={slot}
            title={slot === mySlot ? "You" : "Another player"}
            style={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: PLAYER_COLORS[slot],
              boxShadow: slot === mySlot ? "0 0 0 2px rgba(255, 255, 255, 0.5)" : "none",
            }}
          />
        ))}
      </div>
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

const dividerLine: React.CSSProperties = {
  width: 1,
  alignSelf: "stretch",
  background: "rgba(255, 255, 255, 0.09)",
};

const roomCode: React.CSSProperties = {
  fontFamily: FONT_DISPLAY,
  fontSize: 13,
  fontWeight: 800,
  letterSpacing: 1.5,
  color: "#cdd3dc",
};

const copyButton: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: 4,
  borderRadius: 6,
  border: "1px solid #3a414e",
  background: "rgba(0, 0, 0, 0.25)",
  color: "#cdd3dc",
  cursor: "pointer",
};
