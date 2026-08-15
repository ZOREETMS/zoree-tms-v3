import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // Allow any Host header (needed for Cloudflare Tunnel / ngrok domains)
    allowedHosts: true,
    // Let Microsoft Teams render the TMS inside a tab iframe
    // (docs/TEAMS_SETUP.md §Tab). Without frame-ancestors the browser
    // blanks the tab silently.
    headers: {
      "Content-Security-Policy":
        "frame-ancestors 'self' https://teams.microsoft.com https://*.teams.microsoft.com https://*.office.com https://*.microsoft365.com https://*.skype.com",
    },
  },
  preview: {
    headers: {
      "Content-Security-Policy":
        "frame-ancestors 'self' https://teams.microsoft.com https://*.teams.microsoft.com https://*.office.com https://*.microsoft365.com https://*.skype.com",
    },
  },
});
