import { useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls, OrthographicCamera } from "@react-three/drei";
import { connection } from "./net/connection";
import { getLatest } from "./world/store";
import { Factory } from "./world/Factory";

export function App() {
  const [connected, setConnected] = useState(false);
  const [tick, setTick] = useState<number | null>(null);

  useEffect(() => {
    const off = connection.onStatus(setConnected);
    connection.start();

    // Sample the store a few times a second for the HUD, instead of
    // re-rendering on every message.
    const id = setInterval(() => {
      setTick(getLatest()?.tick ?? null);
    }, 200);

    return () => {
      off();
      clearInterval(id);
    };
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0f1115" }}>
      <Canvas>
        <OrthographicCamera makeDefault position={[14, 16, 14]} zoom={48} />
        <OrbitControls makeDefault />
        <ambientLight intensity={0.7} />
        <directionalLight position={[8, 14, 6]} intensity={1.4} />
        <Grid
          infiniteGrid
          cellSize={1}
          sectionSize={5}
          fadeDistance={45}
          fadeStrength={1.5}
          cellColor="#262b35"
          sectionColor="#39414f"
        />
        <Factory />
      </Canvas>

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
        <div style={{ fontSize: 13 }}>tick: {tick ?? "-"}</div>
      </div>
    </div>
  );
}
