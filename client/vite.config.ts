import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { target: "chrome69", outDir: "dist", assetsInlineLimit: 0, chunkSizeWarningLimit: 2000 },
  server: { proxy: { "/api": "http://127.0.0.1:8100", "/img": "http://127.0.0.1:8100" } },
});
