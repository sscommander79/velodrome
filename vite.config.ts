import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// base is '/velodrome/' for the production build (GitHub Pages serves the repo
// at a subpath), but '/' for local dev so `npm run dev` works at the root.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/velodrome/" : "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: true,
    open: true,
  },
}));
