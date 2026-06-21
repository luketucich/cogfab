import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Honour a PORT env var (used by some tooling/preview hosts); otherwise use
// Vite's default dev port.
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PORT) || 5173,
  },
});
