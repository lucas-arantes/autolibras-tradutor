/** Estado e chamadas à API de sessões usados pela página Estúdio. */
import type { VLibrasAvatar } from "@autolibras/vlibras";
import { SIGN_PACK_URL } from "./avatar";

export type StudioSource = "audio" | "url" | "text" | "rtmp";

/** Composição no servidor: a transmissão sai com a janela de Libras embutida. */
export interface CompositionSettings {
  enabled: boolean;
  /** Para onde vai a transmissão pronta (rtmp://, rtmps:// ou srt://, com a chave). */
  output: string;
  delay: number;
  position: "right" | "left";
  size: number;
  background: "painel" | "recorte";
  caption: boolean;
  resolution: string;
}
/** Avatar do overlay: o próprio do AutoLibras ou um personagem do VLibras. */
export type StudioAvatar = "propio" | VLibrasAvatar;

export interface StudioSettings {
  /** Endereço do servidor (`services/stt-server`), por exemplo `http://localhost:8000`. */
  server: string;
  token: string;
  /** Id fixo da sessão: a URL do overlay no OBS não muda entre uma live e outra. */
  sessionId: string;
  source: StudioSource;
  deviceId: string;
  streamUrl: string;
  /** Vídeo gravado: o servidor lê na velocidade real. */
  realtime: boolean;
  /** Endereço: usar a legenda da transmissão (WebVTT ou closed caption) em vez da fala. */
  captions: boolean;
  /** Modo sincronizado: atraso, em segundos, do vídeo da transmissão. 0 desliga. */
  syncDelay: number;
  avatar: StudioAvatar;
  /** Pacote de sinais do avatar próprio. Vazio: o do servidor, se houver, ou o do build. */
  signsUrl: string;
  caption: boolean;
  composition: CompositionSettings;
}

export interface ServerHealth {
  model: string;
  tokenRequired: boolean;
  /** O servidor também serve o app (imagem Docker): o overlay sai dele. */
  web: boolean;
  /** O servidor serve um pacote de sinais do avatar próprio em `/signs/`. */
  signs: boolean;
  /** O servidor consegue compor a janela de Libras no vídeo; se não, o motivo. */
  composition?: boolean;
  compositionError?: string | null;
}

export interface SessionInfo {
  id: string;
  source: StudioSource;
  state: "waiting" | "live" | "ended" | "error";
  error: string | null;
  subscribers: number;
  /** Segundos do começo da fala até o final sair do servidor, nas últimas frases. */
  latency: { p50: number; p95: number; recommendedDelay: number; count: number } | null;
  /** Chave do formulário público de retorno desta sessão. */
  feedbackKey: string;
  composition?: { state: string; frames: number; output: string } | null;
  /** Onde o OBS envia (só na resposta de criação e na lista, que pedem token). */
  rtmp?: { server: string; key: string };
}

export interface FeedbackItem {
  time: number;
  rating: "good" | "bad";
  comment: string;
  sentence: string;
  source: string;
}

export interface FeedbackList {
  summary: { good: number; bad: number };
  items: FeedbackItem[];
}

/** Página pública em que o público diz se entendeu (para pôr no chat ou na descrição). */
export function feedbackPageUrl(
  server: string,
  key: string,
  pageBase: string,
  servedByServer: boolean,
): string {
  const url = new URL("feedback.html", servedByServer ? base(server) : pageBase);
  url.searchParams.set("f", key);
  if (!servedByServer) url.searchParams.set("server", server);
  return url.toString();
}

const KEY = "autolibras:studio";

/** Id aleatório de 22 caracteres (128 bits), no formato aceito pelo servidor. */
export function newSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function defaultSettings(origin: string, servedByServer: boolean): StudioSettings {
  return {
    server: servedByServer ? origin : "http://localhost:8000",
    token: "",
    sessionId: newSessionId(),
    source: "audio",
    deviceId: "",
    streamUrl: "",
    realtime: false,
    captions: false,
    syncDelay: 0,
    composition: {
      enabled: false,
      output: "",
      delay: 8,
      position: "right",
      size: 0.5,
      background: "painel",
      caption: true,
      resolution: "1280x720",
    },
    avatar: "propio",
    signsUrl: "",
    caption: false,
  };
}

export function loadStudioSettings(fallback: StudioSettings): StudioSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<StudioSettings>;
    // Configurações salvas por versões antigas não têm todos os campos da composição.
    return {
      ...fallback,
      ...saved,
      composition: { ...fallback.composition, ...saved.composition },
    };
  } catch {
    return fallback;
  }
}

export function saveStudioSettings(settings: StudioSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Sem armazenamento: o id muda a cada visita, e a URL do overlay também.
  }
}

function base(server: string): string {
  return server.endsWith("/") ? server : `${server}/`;
}

/** Pacote de sinais que o overlay vai usar, ou vazio se não houver nenhum. */
export function signPackFor(
  settings: Pick<StudioSettings, "server" | "signsUrl">,
  server: Pick<ServerHealth, "signs"> | null,
  buildPack: string = SIGN_PACK_URL,
): string {
  if (settings.signsUrl.trim()) return settings.signsUrl.trim();
  if (server?.signs) return new URL("signs/", base(settings.server)).toString();
  return buildPack;
}

/** Endereço para colar no OBS. */
export function overlayUrl(
  settings: Pick<
    StudioSettings,
    "server" | "sessionId" | "avatar" | "signsUrl" | "caption" | "syncDelay"
  >,
  pageBase: string,
  server: Pick<ServerHealth, "web" | "signs"> | null,
  buildPack: string = SIGN_PACK_URL,
): string {
  // O overlay deve vir do próprio servidor sempre que possível: assim o OBS não
  // esbarra em bloqueio de conteúdo misto nem de acesso à rede local.
  const served = server?.web ?? false;
  const url = new URL("broadcast.html", served ? base(settings.server) : pageBase);
  url.searchParams.set("session", settings.sessionId);
  if (!served) url.searchParams.set("server", settings.server);
  url.searchParams.set("avatar", settings.avatar);
  if (settings.avatar === "propio") {
    const signs = signPackFor(settings, server, buildPack);
    if (signs && signs !== buildPack) url.searchParams.set("signs", signs);
  }
  if (settings.caption) url.searchParams.set("legenda", "1");
  if (settings.syncDelay > 0) url.searchParams.set("atraso", String(settings.syncDelay));
  return url.toString();
}

/** WebSocket por onde o Estúdio envia o áudio da sessão. */
export function ingestUrl(server: string, sessionId: string, token: string): string {
  const url = new URL(`v1/sessions/${encodeURIComponent(sessionId)}/ingest`, base(server));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  if (token) url.searchParams.set("token", token);
  return url.toString();
}

function textPath(sessionId: string): string {
  return `v1/sessions/${encodeURIComponent(sessionId)}/text`;
}

/** Endereço para outros programas (estenotipia, sistema de legendas) enviarem texto. */
export function textUrl(server: string, sessionId: string): string {
  return new URL(textPath(sessionId), base(server)).toString();
}

/** O pedido de composição, se ela estiver ligada e a fonte permitir. */
export function compositionBody(
  settings: Pick<StudioSettings, "source" | "composition">,
): Omit<CompositionSettings, "enabled"> | undefined {
  const { enabled, ...composition } = settings.composition;
  if (!enabled || (settings.source !== "url" && settings.source !== "rtmp")) return undefined;
  return { ...composition, output: composition.output.trim() };
}

export class SessionApi {
  constructor(
    readonly server: string,
    readonly token: string,
    readonly fetcher: typeof fetch = (...args) => fetch(...args),
  ) {}

  health(): Promise<ServerHealth> {
    return this.#request<ServerHealth>("GET", "health");
  }

  create(settings: StudioSettings): Promise<SessionInfo> {
    const source =
      settings.source === "url"
        ? {
            type: "url",
            url: settings.streamUrl.trim(),
            realtime: settings.realtime,
            captions: settings.captions,
          }
        : { type: settings.source };
    return this.#request<SessionInfo>("POST", "v1/sessions", {
      id: settings.sessionId,
      source,
      composition: compositionBody(settings),
    });
  }

  get(sessionId: string): Promise<SessionInfo> {
    return this.#request<SessionInfo>("GET", `v1/sessions/${encodeURIComponent(sessionId)}`);
  }

  /** Envia um texto pronto para a sessão: `final` vai para o avatar; senão, só a legenda. */
  async text(sessionId: string, text: string, final = true): Promise<void> {
    await this.#request<unknown>("POST", textPath(sessionId), { text, final });
  }

  feedback(key: string): Promise<FeedbackList> {
    return this.#request<FeedbackList>("GET", `v1/feedback?key=${encodeURIComponent(key)}`);
  }

  async delete(sessionId: string): Promise<void> {
    await this.#request<void>("DELETE", `v1/sessions/${encodeURIComponent(sessionId)}`);
  }

  async #request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let response: Response;
    try {
      response = await this.fetcher(new URL(path, base(this.server)), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new Error(
        `Não foi possível falar com o servidor em ${this.server}. Ele está rodando? ` +
          "Se esta página veio de outro endereço, permita o acesso à rede local no navegador.",
      );
    }
    if (response.status === 401) throw new Error("Token inválido ou ausente.");
    if (!response.ok) {
      const detail = await response
        .json()
        .then((data: { detail?: unknown }) => data.detail)
        .catch(() => undefined);
      throw new Error(typeof detail === "string" ? detail : `Erro ${response.status} no servidor.`);
    }
    return (response.status === 204 ? undefined : await response.json()) as T;
  }
}
