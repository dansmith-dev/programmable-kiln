import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// Everything (JS, CSS, icons) is inlined into one dist/index.html, which build.ps1
// compresses into ../webpage.h for the kiln to serve. Nothing is loaded from the internet.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
  },
  server: {
    // `npm run dev` talks to the pretend kiln (`npm run mock`) or a real one:
    //   $env:KILN = "http://192.168.1.50"; npm run dev
    proxy: { "/api": process.env.KILN || "http://localhost:8080" },
  },
});
