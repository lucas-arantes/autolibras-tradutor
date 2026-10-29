import { Emitter, type SpeechRecognizer, type SpeechRecognizerEvents } from "@autolibras/core";

// Tipos mínimos da Web Speech API, que não faz parte do lib.dom do TypeScript.
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

export interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: { readonly length: number; [index: number]: SpeechRecognitionResultLike };
}

export interface SpeechRecognitionErrorEventLike {
  readonly error: string;
}

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export function getSpeechRecognition(): SpeechRecognitionConstructor | undefined {
  const scope = globalThis as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

/** Erros que impedem continuar ouvindo; os demais são transitórios. */
const FATAL_ERRORS: Readonly<Record<string, string>> = {
  "not-allowed": "Permissão de microfone negada.",
  "service-not-allowed": "O navegador não permitiu o serviço de reconhecimento de fala.",
  "audio-capture": "Nenhum microfone encontrado.",
  "language-not-supported": "O navegador não reconhece fala em português do Brasil.",
};

const IGNORED_ERRORS = new Set(["no-speech", "aborted"]);

export interface WebSpeechRecognizerOptions {
  lang?: string;
  /** Construtor alternativo (testes ou polyfills). */
  recognition?: SpeechRecognitionConstructor;
  /** Pausa antes de religar quando o navegador encerra a sessão sozinho. */
  restartDelayMs?: number;
}

/**
 * Reconhecimento contínuo via Web Speech API. No Chrome o áudio é enviado aos
 * servidores do Google; o app deve avisar o usuário. O navegador encerra a
 * sessão após silêncio ou ~1 min, então ela é religada enquanto estiver ativa.
 */
export class WebSpeechRecognizer
  extends Emitter<SpeechRecognizerEvents>
  implements SpeechRecognizer
{
  readonly name = "web-speech";
  readonly #lang: string;
  readonly #recognitionClass: SpeechRecognitionConstructor | undefined;
  readonly #restartDelayMs: number;
  #recognition?: SpeechRecognitionLike;
  #active = false;
  #session = 0;
  #restartTimer?: ReturnType<typeof setTimeout>;

  constructor({
    lang = "pt-BR",
    recognition,
    restartDelayMs = 250,
  }: WebSpeechRecognizerOptions = {}) {
    super();
    this.#lang = lang;
    this.#recognitionClass = recognition ?? getSpeechRecognition();
    this.#restartDelayMs = restartDelayMs;
  }

  static isSupported(): boolean {
    return getSpeechRecognition() !== undefined;
  }

  get active(): boolean {
    return this.#active;
  }

  start(): void {
    if (this.#active) return;
    if (!this.#recognitionClass) {
      this.#fail("Este navegador não oferece a Web Speech API. Use Chrome, Edge ou Safari.");
      return;
    }
    this.#active = true;
    this.#startSession();
  }

  stop(): void {
    this.#active = false;
    clearTimeout(this.#restartTimer);
    this.#recognition?.stop();
  }

  #startSession(): void {
    const Recognition = this.#recognitionClass as SpeechRecognitionConstructor;
    const recognition = new Recognition();
    const session = ++this.#session;
    recognition.lang = this.#lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => this.emit("state", "listening");
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result?.[0]?.transcript.trim();
        if (!result || !text) continue;
        this.emit("transcript", {
          id: `fala-${session}-${i}`,
          text,
          isFinal: result.isFinal,
          timestamp: Date.now(),
        });
      }
    };
    recognition.onerror = (event) => {
      if (IGNORED_ERRORS.has(event.error)) return;
      const fatal = FATAL_ERRORS[event.error];
      if (fatal) {
        this.#active = false;
        this.#fail(fatal);
        return;
      }
      this.emit("error", new Error(`Erro no reconhecimento de fala: ${event.error}`));
    };
    recognition.onend = () => {
      if (this.#recognition !== recognition) return;
      if (this.#active) {
        this.#restartTimer = setTimeout(() => this.#startSession(), this.#restartDelayMs);
      } else {
        this.emit("state", "idle");
      }
    };

    this.#recognition = recognition;
    try {
      recognition.start();
    } catch (error) {
      this.#active = false;
      this.#fail(error instanceof Error ? error.message : String(error));
    }
  }

  #fail(message: string): void {
    this.emit("error", new Error(message));
    this.emit("state", "error");
  }
}
