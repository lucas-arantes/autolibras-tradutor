/**
 * Overlay para transmissões: o avatar sozinho, com fundo transparente, para
 * usar como fonte de navegador no OBS. Recebe as frases de uma sessão do
 * servidor de transcrição (`services/stt-server`), que ouve o Estúdio ou o
 * endereço da transmissão, e sinaliza com a mesma fila do app.
 *
 * Parâmetros da URL:
 * - `session` (obrigatório): id da sessão, mostrado no Estúdio;
 * - `server`: endereço do servidor; padrão, o próprio endereço desta página;
 * - `translator=vlibras|regras` e `avatar=icaro|hosana|guga`, como no player;
 * - `legenda=1`: mostra a frase que está sendo sinalizada;
 * - `status=1`: mostra o estado da conexão (útil ao configurar; some quando tudo vai bem).
 */
import { FallbackTranslator, Pipeline } from "@autolibras/core";
import { RulesTranslator } from "@autolibras/gloss-rules";
import { SessionRecognizer, type SessionStatus } from "@autolibras/stt-web";
import {
  loadVLibrasVocabulary,
  VLibrasApiTranslator,
  type VLibrasAvatar,
  VLibrasWidgetRenderer,
} from "@autolibras/vlibras";

const AVATARS: readonly VLibrasAvatar[] = ["icaro", "hosana", "guga"];

const params = new URLSearchParams(location.search);
const flag = (name: string) => ["1", "sim", "true"].includes(params.get(name) ?? "");
const statusEl = document.getElementById("status") as HTMLElement;
const captionEl = document.getElementById("caption") as HTMLElement;
const showStatus = flag("status");
captionEl.hidden = !flag("legenda");

/** Mensagem de estado. Sem `status=1`, só aparece enquanto o avatar não carregou. */
function setStatus(text: string, always = false): void {
  statusEl.textContent = showStatus || always ? text : "";
}

const sessionId = params.get("session")?.trim();
if (!sessionId) {
  setStatus(
    "Falta o parâmetro session na URL. Copie o endereço do overlay na página Estúdio.",
    true,
  );
  throw new Error("Overlay sem sessão");
}

const rules = new RulesTranslator();
loadVLibrasVocabulary()
  .then((vocabulary) => rules.setVocabulary(vocabulary))
  .catch(() => undefined);
const translator =
  params.get("translator") === "regras"
    ? rules
    : new FallbackTranslator([new VLibrasApiTranslator(), rules]);
const avatarParam = params.get("avatar") as VLibrasAvatar | null;
const renderer = new VLibrasWidgetRenderer({
  avatar: avatarParam && AVATARS.includes(avatarParam) ? avatarParam : "icaro",
});
const pipeline = new Pipeline({ translator, renderer });
const recognizer = new SessionRecognizer({
  server: params.get("server") || location.origin,
  sessionId,
});
pipeline.attach(recognizer);

pipeline.on("start", (item) => {
  captionEl.textContent = item.text;
});
pipeline.on("queue", ({ current, pending }) => {
  if (!current && pending.length === 0) captionEl.textContent = "";
});
pipeline.on("error", ({ source, error }) => {
  console.warn(`[AutoLibras] ${source}: ${error.message}`);
});

const SESSION_TEXT: Record<SessionStatus["state"], string> = {
  connecting: "Conectando à sessão…",
  offline: "Sem conexão com a sessão. Tentando de novo…",
  missing: "A sessão ainda não começou. Clique em Iniciar no Estúdio.",
  waiting: "Sessão pronta, esperando o áudio.",
  live: "",
  ended: "A sessão foi encerrada. O avatar volta quando ela for iniciada de novo.",
  error: "Erro na sessão.",
};

let loaded = false;
recognizer.on("session", ({ state, error }) => {
  if (!loaded) return;
  setStatus(error && state === "error" ? `Erro na sessão: ${error}` : SESSION_TEXT[state]);
});

/**
 * Deixa só o avatar do Widget do VLibras, no canto superior esquerdo, sem
 * cabeçalho, barra de controles nem sombra. A moldura fica invisível mas no
 * lugar, porque o player (Unity, num iframe) depende do layout do Widget e não
 * se adapta a outro tamanho: a fonte do OBS deve ter 260 × 380 (o player tem
 * 260 × 328, e a legenda cabe embaixo), e o OBS amplia a fonte na cena.
 * Depende da estrutura atual do Widget; se ela mudar, o overlay continua
 * funcionando, só com a moldura. O fundo do player continua opaco.
 */
function compactVLibrasWidget(): void {
  const shadow = document.getElementById("vlibras-app-root")?.shadowRoot;
  if (!shadow) return;
  const style = document.createElement("style");
  style.textContent = `
    #vlibras-app {
      inset: -44px auto auto 0 !important; translate: none !important;
      transform: none !important; animation: none !important;
    }
    #vlibras-app > div { border-radius: 0 !important; box-shadow: none !important; }
    #vlibras-app-content > :not(iframe) { visibility: hidden !important; }
  `;
  shadow.append(style);
}

setStatus("Carregando o avatar…", true);
renderer
  .load()
  .then(() => {
    compactVLibrasWidget();
    loaded = true;
    setStatus("");
    recognizer.start();
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Não foi possível carregar o avatar: ${message}`, true);
  });
