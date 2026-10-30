import { defineConfig } from "vite";

// Extensão Manifest V3: páginas HTML (popup, offscreen, overlay) e o service
// worker, que precisa de um nome fixo (`background.js`) para o manifest.
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // O polyfill de modulepreload usa script inline, proibido pela CSP de extensões.
    modulePreload: { polyfill: false },
    // A CSP de extensões recusa worklets em data: ou blob:, então ele sai como arquivo.
    assetsInlineLimit: (file) => (file.endsWith("capture-worklet.js") ? false : undefined),
    rollupOptions: {
      input: {
        popup: "popup.html",
        offscreen: "offscreen.html",
        overlay: "overlay.html",
        background: "src/background.ts",
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js",
      },
    },
  },
});
