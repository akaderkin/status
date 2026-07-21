import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  appType: "spa",
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/admin": { target: "http://127.0.0.1:3000", changeOrigin: true },
      "/v1": { target: "http://127.0.0.1:3000", changeOrigin: true },
      "/health": { target: "http://127.0.0.1:3000", changeOrigin: true },
    },
  },
  preview: {
    port: 5173,
  },
});
