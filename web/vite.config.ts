import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Fail loud if 5173 is taken instead of silently sliding to 5174 — otherwise
    // curls and the browser end up against whoever's already on the canonical port.
    strictPort: true,
    proxy: {
      "/api": "http://localhost:8787",
      "/health": "http://localhost:8787",
    },
  },
});
