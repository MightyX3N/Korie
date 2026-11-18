import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/web/",
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:8100", "/img": "http://localhost:8100" } },
});
