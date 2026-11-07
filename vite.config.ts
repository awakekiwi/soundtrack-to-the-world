import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig(({ mode }) => ({
  // GitHub Pages serves the site from /<repo-name>/ (set by the deploy workflow)
  base: process.env.BASE_PATH || "/",
  server: { host: "::", port: 8080 },
  esbuild: { drop: mode === "production" ? ["console", "debugger"] : [] },
  // three.js (globe) and hls.js (chunked streams) are loaded on demand, so
  // they split into their own files automatically
  build: { chunkSizeWarningLimit: 1200 },
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
}));
