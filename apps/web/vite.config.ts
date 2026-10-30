import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [svelte()],
  server: { port: 5173 },
  build: {
    // O worklet de captura sai como arquivo, para funcionar também sob CSP restritiva.
    assetsInlineLimit: (file) => (file.endsWith("capture-worklet.js") ? false : undefined),
    rollupOptions: {
      // `player.html` é o avatar sozinho, embutido pela extensão do navegador.
      input: { main: "index.html", player: "player.html" },
    },
  },
});
