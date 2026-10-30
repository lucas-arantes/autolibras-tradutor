import { defineConfig } from "vite";

export default defineConfig({
  // Caminhos relativos: a demo funciona em qualquer subcaminho.
  base: "./",
  server: { port: 5180 },
  preview: { port: 5180 },
});
