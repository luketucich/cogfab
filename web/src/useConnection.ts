import { useEffect, useState } from "react";
import { connection } from "./net/connection";
import { getLatest } from "./world/store";

// useConnection starts the WebSocket connection and reports the connection
// status plus the latest tick, sampled a few times a second for the HUD.
export function useConnection(): { connected: boolean; tick: number | null } {
  const [connected, setConnected] = useState(false);
  const [tick, setTick] = useState<number | null>(null);

  useEffect(() => {
    const off = connection.onStatus(setConnected);
    connection.start();
    const id = setInterval(() => setTick(getLatest()?.tick ?? null), 200);
    return () => {
      off();
      clearInterval(id);
    };
  }, []);

  return { connected, tick };
}
