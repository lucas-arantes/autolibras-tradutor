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
 * Parâmetros da URL:
 * - `translator=vlibras|regras`;
 * - `avatar=propio|vlibras`, ou um personagem do VLibras (`icaro`, `hosana`, `guga`). Sem
 *   ele, vale o avatar próprio se houver pacote de sinais, senão o VLibras;
 * - `signs=URL`: pacote de sinais do avatar próprio (padrão: o definido no build);
 * - `bg=transparent` ou uma cor CSS: fundo do avatar próprio (padrão: transparente).
 */
import { FallbackTranslator, Pipeline } from "@autolibras/core";
import { RulesTranslator } from "@autolibras/gloss-rules";
import {
  loadVLibrasVocabulary,
  VLibrasApiTranslator,
  type VLibrasAvatar,
} from "@autolibras/vlibras";
import { createAvatar, defaultAvatarKind, parseAvatarKind, SIGN_PACK_URL } from "./lib/avatar";

const AVATARS: readonly VLibrasAvatar[] = ["icaro", "hosana", "guga"];

const params = new URLSearchParams(location.search);
const rules = new RulesTranslator();
loadVLibrasVocabulary()
  .then((vocabulary) => rules.setVocabulary(vocabulary))
  .catch(() => undefined);
const translator =
  params.get("translator") === "regras"
    ? rules
    : new FallbackTranslator([new VLibrasApiTranslator(), rules]);
const avatarParam = params.get("avatar");
const persona = AVATARS.find((a) => a === avatarParam);
const signsUrl = params.get("signs")?.trim() || SIGN_PACK_URL;
const kind = persona ? "vlibras" : (parseAvatarKind(avatarParam) ?? defaultAvatarKind(signsUrl));
const bg = params.get("bg");
const status = document.getElementById("status");
if (status) {
  status.textContent =
    kind === "propio"
      ? "Carregando o avatar e o pacote de sinais…"
      : "Carregando o avatar do VLibras…";
}
const avatar = await createAvatar(kind, {
  vlibrasAvatar: persona ?? "icaro",
  signsUrl,
  background: !bg || bg === "transparent" ? null : bg,
});
if (avatar.canvas) {
  avatar.canvas.id = "avatar";
  document.body.append(avatar.canvas);
}
const { renderer } = avatar;
const pipeline = new Pipeline({ translator, renderer });

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
