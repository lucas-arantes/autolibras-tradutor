import type { Subscribable } from "./emitter";

/** Trecho de fala transcrito. Parciais podem mudar; finais são estáveis. */
export interface TranscriptSegment {
  id: string;
  text: string;
  isFinal: boolean;
  timestamp: number;
}

export type RecognizerState = "idle" | "listening" | "error";

export type SpeechRecognizerEvents = {
  transcript: TranscriptSegment;
  state: RecognizerState;
  error: Error;
};

/** Fonte de texto a partir de áudio (Web Speech, Whisper remoto, etc.). */
export interface SpeechRecognizer extends Subscribable<SpeechRecognizerEvents> {
  readonly name: string;
  start(): void;
  stop(): void;
}

export interface GlossResult {
  gloss: string;
  /** Nome do tradutor que produziu a glosa. */
  source: string;
}

/** Tradução de português para glosa de Libras. */
export interface GlossTranslator {
  readonly name: string;
  translate(text: string, signal?: AbortSignal): Promise<GlossResult>;
}

/** Avatar que sinaliza glosas. `play` resolve quando a sinalização termina. */
export interface AvatarRenderer {
  readonly name: string;
  load(): Promise<void>;
  play(gloss: string): Promise<void>;
  stop(): void;
  setSpeed(speed: number): void;
}
