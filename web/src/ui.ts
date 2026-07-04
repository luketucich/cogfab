import type { CSSProperties } from "react";

// Shared look for the on-screen HUD: a game font for headline numbers and a
// frosted-dark card the panels sit in, so every overlay matches.

export const FONT_DISPLAY = "'Baloo 2', ui-rounded, system-ui, sans-serif"; // the fun game font
export const FONT_UI = "'Nunito', system-ui, sans-serif"; // its clean rounded sidekick for labels

export const ACCENT = "#6ea8ff"; // selected / interactive highlight
export const ORE_TEXT = "#d9b878"; // ore amounts and prices, a warm metal tone
export const DANGER = "#e05260"; // blocked actions and offline states

// PLAYER_COLORS is the default colour per player slot: four seats, four hues
// that read on the dark floor. Mirror of maxPlayers in internal/server/rooms.go.
export const PLAYER_COLORS = ["#58a6ff", "#f6c453", "#5fd47a", "#e77fd0"];

// SWATCHES is what the lobby's colour picker offers: the four defaults plus
// four more that still read on the dark floor.
export const SWATCHES = [...PLAYER_COLORS, "#ff8a5c", "#9c8cff", "#4dd4c2", "#f0f3f8"];

// playerColor is the colour a player shows as: their pick, or their slot's
// default when they never picked one.
export function playerColor(p: { slot: number; color: string }): string {
  return p.color || PLAYER_COLORS[p.slot];
}

// isTyping reports whether a keyboard event belongs to a text field, so game
// hotkeys leave typing (like the room-code box) alone.
export const isTyping = (e: KeyboardEvent): boolean => e.target instanceof HTMLInputElement;

// panel is the frosted-dark card every HUD piece sits in.
export const panel: CSSProperties = {
  position: "absolute",
  background: "rgba(18, 21, 28, 0.66)",
  border: "1px solid rgba(255, 255, 255, 0.08)",
  borderRadius: 14,
  backdropFilter: "blur(8px)",
  color: "#e6e6e6",
  fontFamily: FONT_UI,
};

// tile is one square hotbar button: an icon over a small label, with room in the
// corner for a hotkey number. The toolbar tools and the reset-view button share it.
export const tile: CSSProperties = {
  position: "relative",
  width: 66,
  height: 66,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 5,
  borderRadius: 12,
  border: "1px solid #3a414e",
  background: "rgba(31, 36, 46, 0.85)",
  color: "#cdd3dc",
  fontFamily: FONT_UI,
  fontSize: 10,
  lineHeight: 1.1,
  textAlign: "center",
  cursor: "pointer",
  backdropFilter: "blur(8px)",
  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.3)",
  transition: "border-color 120ms, background 120ms, color 120ms, transform 80ms, box-shadow 120ms",
};
