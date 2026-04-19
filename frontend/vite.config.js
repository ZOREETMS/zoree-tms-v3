import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // Allow any Host header (needed for Cloudflare Tunnel / ngrok domains)
    allowedHosts: true,
  },
});
