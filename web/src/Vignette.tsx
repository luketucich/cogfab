// Vignette darkens the screen toward the edges, so the light pools around the
// centre of the view. A screen-space overlay stays consistent at every zoom
// level. Lower the transparent stop for a stronger, tighter vignette.
export function Vignette() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        background:
          "radial-gradient(ellipse 85% 85% at 50% 50%, transparent 32%, #1a1e27 100%)",
      }}
    />
  );
}
