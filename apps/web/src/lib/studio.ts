/** Estado e chamadas à API de sessões usados pela página Estúdio. */
import type { VLibrasAvatar } from "@autolibras/vlibras";

export type StudioSource = "audio" | "url";

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
  avatar: VLibrasAvatar;
  caption: boolean;
}

export interface ServerHealth {
  model: string;
  tokenRequired: boolean;
  /** O servidor também serve o app (imagem Docker): o overlay sai dele. */
  web: boolean;
}

export interface SessionInfo {
  id: string;
  source: StudioSource;
  state: "waiting" | "live" | "ended" | "error";
  error: string | null;
  subscribers: number;
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
    avatar: "icaro",
    caption: false,
  };
}

export function loadStudioSettings(fallback: StudioSettings): StudioSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<StudioSettings>;
    return { ...fallback, ...saved };
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

/** Endereço para colar no OBS. */
export function overlayUrl(
  settings: Pick<StudioSettings, "server" | "sessionId" | "avatar" | "caption">,
  pageBase: string,
  servedByServer: boolean,
): string {
  // O overlay deve vir do próprio servidor sempre que possível: assim o OBS não
  // esbarra em bloqueio de conteúdo misto nem de acesso à rede local.
  const url = new URL("broadcast.html", servedByServer ? base(settings.server) : pageBase);
  url.searchParams.set("session", settings.sessionId);
  if (!servedByServer) url.searchParams.set("server", settings.server);
  if (settings.avatar !== "icaro") url.searchParams.set("avatar", settings.avatar);
  if (settings.caption) url.searchParams.set("legenda", "1");
  return url.toString();
}

/** WebSocket por onde o Estúdio envia o áudio da sessão. */
export function ingestUrl(server: string, sessionId: string, token: string): string {
  const url = new URL(`v1/sessions/${encodeURIComponent(sessionId)}/ingest`, base(server));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  if (token) url.searchParams.set("token", token);
  return url.toString();
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
        ? { type: "url", url: settings.streamUrl.trim(), realtime: settings.realtime }
        : { type: "audio" };
    return this.#request<SessionInfo>("POST", "v1/sessions", { id: settings.sessionId, source });
  }

  get(sessionId: string): Promise<SessionInfo> {
    return this.#request<SessionInfo>("GET", `v1/sessions/${encodeURIComponent(sessionId)}`);
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
