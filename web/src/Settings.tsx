import { useEffect, useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import { PiGearSixFill } from "react-icons/pi";
import {
  getAudioSettings,
  setEffectsVolume,
  setMusicVolume,
  subscribeAudioSettings,
} from "./audioSettings";
import { sfx } from "./sfx";
import { FONT_DISPLAY, panel, tile } from "./ui";

const CONTROLS: [string, string][] = [
  ["Drag", "Preview and place a building line"],
  ["Right drag", "Pan the camera"],
  ["Scroll", "Zoom at the cursor"],
  ["Q / E", "Spin the camera"],
  ["R", "Rotate a building or your aim"],
  ["Shift", "Lock the placement direction"],
  ["1 - 5", "Pick a tool"],
];

export function Settings() {
  const [open, setOpen] = useState(false);
  const audio = useSyncExternalStore(subscribeAudioSettings, getAudioSettings);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  return (
    <div className="hud-settings">
      {open && (
        <section aria-label="Settings panel" className="hud-settings__sheet" style={sheet}>
          <div style={heading}>Settings</div>
          <div style={sectionLabel}>Audio</div>
          <VolumeSlider label="Music" value={audio.music} onChange={setMusicVolume} />
          <VolumeSlider label="Sound effects" value={audio.effects} onChange={setEffectsVolume} />
          <div style={sectionLabel}>Controls</div>
          <div style={controlsList}>
            {CONTROLS.map(([keys, action]) => (
              <div key={keys} style={controlRow}>
                <span style={kbd}>{keys}</span>
                <span style={controlText}>{action}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      <button
        className="hud-corner-button"
        onClick={() => {
          setOpen((value) => !value);
          sfx.select();
        }}
        title="Settings"
        aria-label="Settings"
        aria-expanded={open}
        style={tile}
      >
        <PiGearSixFill size={26} />
      </button>
    </div>
  );
}

type VolumeSliderProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
};

function VolumeSlider({ label, value, onChange }: VolumeSliderProps) {
  const percent = Math.round(value * 100);
  return (
    <label style={sliderRow}>
      <span style={sliderLabel}>
        <span>{label}</span>
        <span style={sliderValue}>{percent}%</span>
      </span>
      <input
        className="hud-volume-slider"
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

const sheet: CSSProperties = {
  ...panel,
  position: "static",
};

const heading: CSSProperties = {
  fontFamily: FONT_DISPLAY,
  fontSize: 17,
  fontWeight: 800,
};

const sectionLabel: CSSProperties = {
  marginTop: 12,
  marginBottom: 7,
  fontSize: 9,
  fontWeight: 800,
  letterSpacing: 1,
  textTransform: "uppercase",
  opacity: 0.45,
};

const sliderRow: CSSProperties = { display: "block", marginTop: 8 };
const sliderLabel: CSSProperties = { display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 700 };
const sliderValue: CSSProperties = { opacity: 0.6, fontVariantNumeric: "tabular-nums" };
const controlsList: CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };
const controlRow: CSSProperties = { display: "flex", alignItems: "center", gap: 9 };
const controlText: CSSProperties = { fontSize: 10, opacity: 0.72 };

const kbd: CSSProperties = {
  minWidth: 64,
  textAlign: "center",
  fontSize: 9,
  fontWeight: 800,
  padding: "3px 6px",
  borderRadius: 6,
  border: "1px solid #3a414e",
  background: "rgba(0, 0, 0, 0.3)",
  color: "#cdd3dc",
  whiteSpace: "nowrap",
};
