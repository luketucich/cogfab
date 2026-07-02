// Vignette darkens the screen toward the edges so light pools at the centre.
// Screen-space, so it holds at any zoom. Lower the transparent stop for a tighter
// vignette.
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
