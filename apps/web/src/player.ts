/**
 * Player embutível: só o avatar, controlado por mensagens da página que o
 * contém (a extensão do navegador). Recebe frases em português, traduz para
 * glosa e sinaliza, usando a mesma fila do app.
 *
 * Mensagens recebidas (`postMessage`):
 * - `{ type: "autolibras:text", text: string }`: frase final para traduzir e sinalizar;
 * - `{ type: "autolibras:clear" }`: esvazia a fila.
 *
 * Mensagens enviadas ao `parent`, todas com `source: "autolibras-player"`:
 * `ready`, `error`, `gloss` (glosa de cada frase) e `queue` (atraso e fila).
 *
 * Parâmetros da URL: `translator=vlibras|regras` e `avatar=icaro|hosana|guga`.
 */
import { FallbackTranslator, Pipeline } from "@autolibras/core";
import { RulesTranslator } from "@autolibras/gloss-rules";
import {
  VLibrasApiTranslator,
  type VLibrasAvatar,
  VLibrasWidgetRenderer,
} from "@autolibras/vlibras";

const AVATARS: readonly VLibrasAvatar[] = ["icaro", "hosana", "guga"];

const params = new URLSearchParams(location.search);
const rules = new RulesTranslator();
const translator =
  params.get("translator") === "regras"
    ? rules
    : new FallbackTranslator([new VLibrasApiTranslator(), rules]);
const avatarParam = params.get("avatar") as VLibrasAvatar | null;
const renderer = new VLibrasWidgetRenderer({
  avatar: avatarParam && AVATARS.includes(avatarParam) ? avatarParam : "icaro",
});
const pipeline = new Pipeline({ translator, renderer });
const status = document.getElementById("status");

function post(message: Record<string, unknown>): void {
  // Sem dados sensíveis: quem embute o player já conhece o texto que mandou.
  if (window.parent !== window)
    window.parent.postMessage({ source: "autolibras-player", ...message }, "*");
}

pipeline.on("gloss", ({ id, text, gloss, source, error }) =>
  post({ type: "gloss", id, text, gloss, translator: source, error }),
);
pipeline.on("queue", ({ lagSeconds, speed, pending, current }) =>
  post({ type: "queue", lagSeconds, speed, pending: pending.length + (current ? 1 : 0) }),
);
pipeline.on("error", ({ source, error }) =>
  post({ type: "error", message: `${source}: ${error.message}` }),
);

window.addEventListener("message", (event: MessageEvent) => {
  const data = event.data as { type?: unknown; text?: unknown } | null;
  if (data?.type === "autolibras:text" && typeof data.text === "string") {
    pipeline.submitText(data.text);
  } else if (data?.type === "autolibras:clear") {
    pipeline.clear();
  }
});

renderer
  .load()
  .then(() => {
    status?.remove();
    post({ type: "ready" });
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (status) status.textContent = `Não foi possível carregar o avatar: ${message}`;
    post({ type: "error", message });
  });
