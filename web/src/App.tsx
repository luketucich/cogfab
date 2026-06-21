import { useEffect, useState } from "react";
import { connection } from "./net/connection";
import { getLatest } from "./world/store";

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
    <main
      style={{
        minHeight: "100vh",
        boxSizing: "border-box",
        background: "#0f1115",
        color: "#e6e6e6",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        padding: 32,
      }}
    >
      <h1 style={{ margin: "0 0 16px", fontSize: 28 }}>Cogfab</h1>
      <p style={{ fontSize: 16 }}>
        server:{" "}
        <span style={{ color: connected ? "#46d369" : "#e05260" }}>
          {connected ? "connected" : "disconnected"}
        </span>
      </p>
      <p style={{ fontSize: 16 }}>
        tick: <strong>{tick ?? "-"}</strong>
      </p>
      <p style={{ color: "#7a7f87", fontSize: 13, marginTop: 24 }}>
        3D view comes next. This page just confirms the live stream reaches the app.
      </p>
    </main>
  );
}
