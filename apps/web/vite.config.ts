import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative base: assets resolve against the page URL, so the same build
  // works at the domain root (tunnel) and under a subpath (GitHub Pages).
  base: "./",
  plugins: [react()],
  worker: {
    format: "es",
  },
  optimizeDeps: {
    // Vite's dependency scan starts from index.html and never crawls into Web
    // Workers. Every library only the conversion worker imports was therefore
    // discovered mid-conversion, re-bundled, and answered with a forced full
    // page reload — the dev server wiped a running conversion a few seconds in.
    // Listing them here pre-bundles them at startup instead. The `>` syntax
    // resolves each through @loomery/core, which is what actually depends on
    // them (pnpm does not hoist them to the web app).
    include: [
      "comlink",
      "@loomery/core > fflate",
      "@loomery/core > fast-png",
      "@loomery/core > upng-js",
      "@loomery/core > js-yaml",
      "@loomery/core > jsonc-parser",
      "@loomery/core > @noble/hashes/sha2",
      "@loomery/core > @gfx/zopfli",
    ],
    // jSquash loads its .wasm relative to its own module URL; pre-bundling moves
    // the module and breaks that path, so it is served as-is (jSquash's own
    // documented Vite setup). Excluded deps are never optimised, so they cannot
    // trigger the reload either.
    exclude: ["@jsquash/oxipng"],
  },
  build: {
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom"],
        },
      },
    },
  },
  server: {
    allowedHosts: true
  },
});
