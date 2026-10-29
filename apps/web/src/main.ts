import { shieldFromTextCapture } from "@autolibras/vlibras";
import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";

const target = document.getElementById("app");
if (!target) throw new Error("Elemento #app não encontrado");

// Sem isso, o Widget do VLibras aberto transforma cliques nos botões do app em traduções.
shieldFromTextCapture(target);
mount(App, { target });

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
