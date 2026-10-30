import { Emitter, type SpeechRecognizer, type SpeechRecognizerEvents } from "@autolibras/core";
import type { SocketLike } from "./remote-whisper";

/** Estado de uma sessão de transmissão no servidor (`services/stt-server`). */
export type SessionState = "waiting" | "live" | "ended" | "error";

export interface SessionStatus {
  /**
   * `connecting`, `offline` (conexão perdida) e `missing` (a sessão ainda não
   * foi criada no Estúdio) são do lado do cliente; os outros vêm do servidor.
   */
  state: SessionState | "connecting" | "offline" | "missing";
  error?: string;
}

export type SessionRecognizerEvents = SpeechRecognizerEvents & { session: SessionStatus };

export interface SessionRecognizerOptions {
  /** Endereço do servidor, por exemplo `http://localhost:8000`. */
  server: string;
  sessionId: string;
  connect?: (url: string) => SocketLike;
  /** Esperas entre tentativas de reconexão, em ms; a última se repete. */
  retryDelays?: readonly number[];
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

/** Código com que o servidor recusa a conexão: sessão inexistente ou origem não permitida. */
const POLICY_VIOLATION = 1008;

type EventMessage =
  | { type: "session"; state: SessionState; error: string | null }
  | { type: "state"; state: SessionState; error: string | null }
  | { type: "partial"; id: string; text: string }
  | { type: "final"; id: string; text: string };

/** Endereço WebSocket dos eventos de uma sessão. */
export function sessionEventsUrl(server: string, sessionId: string): string {
  const url = new URL(`v1/sessions/${encodeURIComponent(sessionId)}/events`, withSlash(server));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function withSlash(server: string): string {
  return server.endsWith("/") ? server : `${server}/`;
}

/**
 * Recebe as transcrições de uma sessão de transmissão, como o overlay do OBS.
 * Não captura áudio: quem envia é o Estúdio ou o próprio servidor (endereço da
 * transmissão). Se a conexão cair, ou se a sessão ainda não existir, tenta de
 * novo sem parar, para o overlay se recuperar sozinho durante a live.
 */
export class SessionRecognizer
  extends Emitter<SessionRecognizerEvents>
  implements SpeechRecognizer
{
  readonly name = "sessao";
  readonly #url: string;
  readonly #connect: (url: string) => SocketLike;
  readonly #retryDelays: readonly number[];
  readonly #setTimer: (callback: () => void, ms: number) => unknown;
  readonly #clearTimer: (timer: unknown) => void;
  #socket?: SocketLike;
  #timer?: unknown;
  #active = false;
  #failures = 0;
  #connection = 0;
  #lastState?: SessionState;

  constructor({
    server,
    sessionId,
    connect,
    retryDelays = [1_000, 2_000, 5_000],
    setTimer = (callback, ms) => setTimeout(callback, ms),
    clearTimer = (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  }: SessionRecognizerOptions) {
    super();
    this.#url = sessionEventsUrl(server, sessionId);
    this.#connect = connect ?? ((u) => new WebSocket(u) as unknown as SocketLike);
    this.#retryDelays = retryDelays;
    this.#setTimer = setTimer;
    this.#clearTimer = clearTimer;
  }

  get url(): string {
    return this.#url;
  }

  start(): void {
    if (this.#active) return;
    this.#active = true;
    this.#open();
  }

  stop(): void {
    if (!this.#active) return;
    this.#active = false;
    this.#connection++;
    if (this.#timer !== undefined) this.#clearTimer(this.#timer);
    this.#timer = undefined;
    this.#socket?.close();
    this.#socket = undefined;
    this.emit("state", "idle");
  }

  #open(): void {
    const connection = ++this.#connection;
    this.emit("session", { state: "connecting" });
    const socket = this.#connect(this.#url);
    this.#socket = socket;
    socket.onmessage = (event) => {
      if (connection === this.#connection) this.#handle(event.data, connection);
    };
    socket.onclose = (event?: { code?: number }) => {
      if (connection !== this.#connection || !this.#active) return;
      this.#socket = undefined;
      this.#failures++;
      if (this.#lastState === "ended") {
        // Encerrada no Estúdio: espera uma nova sessão com o mesmo id.
        this.emit("session", { state: "ended" });
      } else if (event?.code === POLICY_VIOLATION) {
        this.emit("session", { state: "missing" });
      } else {
        this.emit("session", {
          state: "offline",
          error: `Sem conexão com a sessão em ${this.#url}.`,
        });
      }
      const delays = this.#retryDelays;
      const delay = delays[Math.min(this.#failures - 1, delays.length - 1)] ?? 5_000;
      this.#timer = this.#setTimer(() => {
        this.#timer = undefined;
        if (this.#active && connection === this.#connection) this.#open();
      }, delay);
    };
    socket.onerror = null;
    socket.onopen = null;
  }

  #handle(data: unknown, connection: number): void {
    if (typeof data !== "string") return;
    let message: EventMessage;
    try {
      message = JSON.parse(data) as EventMessage;
    } catch {
      return;
    }
    switch (message.type) {
      case "session":
      case "state":
        if (message.type === "session") {
          this.#failures = 0;
          this.emit("state", "listening");
        }
        this.#lastState = message.state;
        this.emit("session", { state: message.state, error: message.error ?? undefined });
        break;
      case "partial":
      case "final": {
        const isFinal = message.type === "final" && message.text.trim() !== "";
        this.emit("transcript", {
          // A sessão pode ser recriada com o mesmo id e recomeçar em s1.
          id: `sessao-${connection}-${message.id}`,
          text: message.text,
          isFinal,
          timestamp: Date.now(),
        });
        break;
      }
    }
  }
}
