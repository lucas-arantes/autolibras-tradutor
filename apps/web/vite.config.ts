import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

function sharedChunk(id: string): string | undefined {
  if (id.includes("/node_modules/")) {
    if (/\/node_modules\/(three|@pixiv)\//.test(id)) return "three";
    if (id.includes("/node_modules/hls.js/")) return "hls";
    if (/\/node_modules\/(svelte|esm-env)\//.test(id)) return "svelte";
    return "vendor";
  }
  const workspacePackage = id.match(/\/packages\/([^/]+)\/src\//);
  if (workspacePackage) return workspacePackage[1];
  if (id.includes("/apps/web/src/lib/")) return "lib";
  return undefined;
}

export default defineConfig({
  plugins: [svelte()],
  server: { port: 5173 },
  build: {
    // O worklet de captura sai como arquivo, para funcionar também sob CSP restritiva.
    assetsInlineLimit: (file) => (file.endsWith("capture-worklet.js") ? false : undefined),
    rollupOptions: {
      // `player.html` é o avatar sozinho, embutido pela extensão do navegador;
      // `studio.html` e `broadcast.html` são o Estúdio e o overlay para o OBS;
      // `avaliacao.html` é o teste de compreensão com pessoas surdas;
      // `assista.html` é a demonstração do "closed signing" num player de vídeo.
      input: {
        main: "index.html",
        player: "player.html",
        studio: "studio.html",
        broadcast: "broadcast.html",
        avaliacao: "avaliacao.html",
        assista: "assista.html",
        // Biblioteca para outros sites, num endereço fixo: `closed-signing.js`.
        "closed-signing": "src/closed-signing-bundle.ts",
      },
      // Mantém as exportações da biblioteca (num build de app elas seriam removidas).
      preserveEntrySignatures: "exports-only",
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "closed-signing" ? "closed-signing.js" : "assets/[name]-[hash].js",
        // Código compartilhado nunca fica no chunk de uma página: se ficasse, a
        // página que o importa (às vezes por `import()`) rodaria o código de
        // início da outra.
        manualChunks: sharedChunk,
      },
    },
  },
});
