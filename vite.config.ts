import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig(({ mode }) => ({
  // GitHub Pages serves the site from /<repo-name>/ (set by the deploy workflow)
  base: process.env.BASE_PATH || "/",
  server: { host: "::", port: 8080 },
  esbuild: { drop: mode === "production" ? ["console", "debugger"] : [] },
  build: {
    rollupOptions: {
      output: { manualChunks: { "vendor-three": ["three", "@react-three/fiber", "@react-three/drei"] } },
    },
  },
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
}));
