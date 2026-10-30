import { mount } from "svelte";
import { defaultSettings, loadStudioSettings } from "./lib/studio";
import Studio from "./Studio.svelte";
import "./app.css";

const target = document.getElementById("app");
if (!target) throw new Error("Elemento #app não encontrado");

/** Se esta página veio do próprio servidor (imagem Docker), ele é o padrão. */
async function servedByServer(): Promise<boolean> {
  try {
    const response = await fetch("health");
    return response.ok && "model" in ((await response.json()) as object);
  } catch {
    return false;
  }
}

const served = await servedByServer();
const initial = loadStudioSettings(defaultSettings(location.origin, served));
const pageBase = new URL(".", location.href).toString();
mount(Studio, { target, props: { initial, pageBase } });
