import { useEffect, useState } from "react";
import { connection } from "./net/connection";

// useConnection starts the WebSocket connection and reports whether it is up.
export function useConnection(): { connected: boolean } {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const off = connection.onStatus(setConnected);
    connection.start();
    return off;
  }, []);

  return { connected };
}
