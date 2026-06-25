import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// GitHub Pages serves the repo at a subpath (/velodrome/), so its build sets
// GH_PAGES=1. Every other target — Vercel/Netlify/Cloudflare and local dev —
// serves at the root, so base stays '/'.
export default defineConfig(() => ({
  base: process.env.GH_PAGES ? "/velodrome/" : "/",
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
