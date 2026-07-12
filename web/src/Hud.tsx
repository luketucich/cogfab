import { useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import { PiCheckBold, PiCopyFill, PiPencilSimpleFill } from "react-icons/pi";
import { useConnection } from "./useConnection";
import { getPing, subscribePing } from "./net/ping";
import { getSession, isRoomCode, subscribeSession, CODE_LENGTH } from "./net/session";
import { setProfile, NAME_LIMIT } from "./net/profile";
import { getPresence, subscribePresence } from "./world/presence";
import type { PresencePlayer } from "./net/types";
import { sfx } from "./sfx";
import { CogfabLogo } from "./CogfabLogo";
import { panel, ACCENT, DANGER, FONT_DISPLAY, SWATCHES, playerColor } from "./ui";

// Hud is the lobby panel in the top left: the game title with the round-trip
// ping, the room code (click it to type a friend's code and jump rooms, or
// copy yours for them), and everyone in the lobby. Your own row is yours to
// dress up: click the name to change it, the pencil for a colour.
export function Hud() {
  const { connected } = useConnection();
  const ping = useSyncExternalStore(subscribePing, getPing);
  const session = useSyncExternalStore(subscribeSession, getSession);
  const players = useSyncExternalStore(subscribePresence, getPresence);
  const ms = ping === null ? null : Math.round(ping);

  return (
    <div style={{ ...panel, top: 14, left: 14, width: 208, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <CogfabLogo />
        <span style={{ ...pingText, ...(connected ? null : { color: DANGER, opacity: 1 }) }}>
          {connected ? (ms === null ? "..." : `${ms}ms`) : "offline"}
        </span>
      </div>
      {session.room && (
        <>
          <div style={divider} />
          <RoomRow code={session.room} />
          <div style={divider} />
          {players.map((p) => (
            <PlayerRow key={p.slot} player={p} you={p.slot === session.slot} />
          ))}
        </>
      )}
    </div>
  );
}

// RoomRow is the room line: the code doubles as a text box (type a friend's
// code and press Enter to jump to their room), and the copy button puts the
// code itself on the clipboard.
function RoomRow({ code }: { code: string }) {
  const [draft, setDraft] = useState<string | null>(null); // null = not editing
  const [copied, setCopied] = useState(false);

  const jump = () => {
    if (draft && isRoomCode(draft) && draft !== code) {
      location.href = `${location.pathname}?room=${draft}`;
    } else {
      setDraft(null); // not a code (or our own): stay put
    }
  };

  const copy = () => {
    void navigator.clipboard.writeText(code);
    sfx.select();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={rowLabel}>Room</span>
      {draft === null ? (
        <button onClick={() => setDraft(code)} title="Type a code to switch rooms" style={codeButton}>
          {code}
        </button>
      ) : (
        <input
          autoFocus
          value={draft}
          maxLength={CODE_LENGTH}
          onChange={(e) => setDraft(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === "Enter") jump();
            if (e.key === "Escape") setDraft(null);
          }}
          onBlur={() => setDraft(null)}
          style={codeInput}
        />
      )}
      <button onClick={copy} title="Copy the room code" style={iconButton}>
        {copied ? <PiCheckBold size={13} color="#5fd47a" /> : <PiCopyFill size={13} />}
      </button>
    </div>
  );
}

// PlayerRow is one lobby member: their cursor colour and name. Your own row
// edits in place: the name is a button, the pencil opens the colour swatches.
function PlayerRow({ player, you }: { player: PresencePlayer; you: boolean }) {
  const [draft, setDraft] = useState<string | null>(null); // null = not editing
  const [picking, setPicking] = useState(false);
  const color = playerColor(player);

  const rename = () => {
    if (draft && draft.trim()) setProfile(draft, player.color);
    setDraft(null);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ ...colorDot, background: color }} />
        {!you ? (
          <span style={nameText}>{player.name}</span>
        ) : draft === null ? (
          <button onClick={() => setDraft(player.name)} title="Change your name" style={nameButton}>
            {player.name}
            <span style={youTag}>you</span>
          </button>
        ) : (
          <input
            autoFocus
            value={draft}
            maxLength={NAME_LIMIT}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") rename();
              if (e.key === "Escape") setDraft(null);
            }}
            onBlur={rename}
            style={nameInput}
          />
        )}
        {you && (
          <button onClick={() => setPicking((v) => !v)} title="Pick your colour" style={iconButton}>
            <PiPencilSimpleFill size={12} />
          </button>
        )}
      </div>
      {you && picking && (
        <div style={swatchRow}>
          {SWATCHES.map((swatch) => (
            <button
              key={swatch}
              onClick={() => {
                setProfile(player.name, swatch);
                setPicking(false);
                sfx.select();
              }}
              title={swatch}
              style={{
                ...swatchButton,
                background: swatch,
                outline: swatch === color ? "2px solid rgba(255, 255, 255, 0.7)" : "none",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const pingText: CSSProperties = { fontSize: 10, fontWeight: 700, opacity: 0.55 };

const divider: CSSProperties = { height: 1, background: "rgba(255, 255, 255, 0.09)" };

const rowLabel: CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: 1,
  textTransform: "uppercase",
  opacity: 0.45,
};

const codeText: CSSProperties = {
  fontFamily: FONT_DISPLAY,
  fontSize: 13,
  fontWeight: 800,
  letterSpacing: 1.5,
  color: "#cdd3dc",
};

const codeButton: CSSProperties = {
  ...codeText,
  padding: "2px 6px",
  borderRadius: 6,
  border: "1px solid transparent",
  background: "none",
  cursor: "text",
};

const codeInput: CSSProperties = {
  ...codeText,
  width: 76,
  padding: "2px 6px",
  borderRadius: 6,
  border: `1px solid ${ACCENT}`,
  background: "rgba(0, 0, 0, 0.35)",
  outline: "none",
  textTransform: "uppercase",
};

const iconButton: CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: 4,
  borderRadius: 6,
  border: "1px solid #3a414e",
  background: "rgba(0, 0, 0, 0.25)",
  color: "#cdd3dc",
  cursor: "pointer",
  marginLeft: "auto",
};

const colorDot: CSSProperties = { width: 10, height: 10, borderRadius: "50%", flexShrink: 0 };

const nameText: CSSProperties = { fontSize: 12, fontWeight: 700, color: "#cdd3dc" };

const nameButton: CSSProperties = {
  ...nameText,
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: 0,
  border: "none",
  background: "none",
  cursor: "text",
};

const youTag: CSSProperties = {
  fontSize: 8,
  fontWeight: 800,
  letterSpacing: 1,
  textTransform: "uppercase",
  opacity: 0.4,
};

const nameInput: CSSProperties = {
  ...nameText,
  width: 120,
  padding: "1px 5px",
  borderRadius: 6,
  border: `1px solid ${ACCENT}`,
  background: "rgba(0, 0, 0, 0.35)",
  outline: "none",
};

const swatchRow: CSSProperties = { display: "flex", gap: 6, marginTop: 7, marginLeft: 18 };

const swatchButton: CSSProperties = {
  width: 15,
  height: 15,
  borderRadius: "50%",
  border: "1px solid rgba(0, 0, 0, 0.4)",
  cursor: "pointer",
  padding: 0,
};
