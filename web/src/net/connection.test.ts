import { describe, it, expect } from "vitest";
import { wsUrl } from "./connection";

describe("wsUrl", () => {
  const at = (protocol: string, host: string, search: string) => ({ protocol, host, search });

  it("derives a secure URL from an https page", () => {
    expect(wsUrl(at("https:", "cogfab.io", ""), false)).toBe("wss://cogfab.io/ws");
  });

  it("stays plain ws on http", () => {
    expect(wsUrl(at("http:", "cogfab.io", ""), false)).toBe("ws://cogfab.io/ws");
  });

  it("falls back to the Go server port in dev, whatever page Vite serves", () => {
    expect(wsUrl(at("http:", "localhost:5173", ""), true)).toBe("ws://localhost:8080/ws");
  });

  it("carries the room code from the address bar", () => {
    expect(wsUrl(at("https:", "cogfab.io", "?room=K7NM2X"), false)).toBe("wss://cogfab.io/ws?room=K7NM2X");
  });
});
