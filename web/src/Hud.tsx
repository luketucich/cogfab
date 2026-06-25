import { useConnection } from "./useConnection";

// Hud is the overlay drawn on top of the 3D scene: the title and connection
// status.
export function Hud() {
  const { connected } = useConnection();

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        left: 16,
        pointerEvents: "none",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        color: "#e6e6e6",
      }}
    >
      <div style={{ fontSize: 20, fontWeight: 700 }}>Cogfab</div>
      <div style={{ fontSize: 13, marginTop: 4 }}>
        server:{" "}
        <span style={{ color: connected ? "#46d369" : "#e05260" }}>
          {connected ? "connected" : "disconnected"}
        </span>
      </div>
    </div>
  );
}
