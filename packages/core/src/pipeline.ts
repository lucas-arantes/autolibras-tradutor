import { Emitter } from "./emitter";
import {
  countSigns,
  type SignItem,
  SignQueue,
  type SignQueueOptions,
  type SignQueueState,
} from "./sign-queue";
import type {
  AvatarRenderer,
  GlossResult,
  GlossTranslator,
  SpeechRecognizer,
  TranscriptSegment,
} from "./types";

export interface GlossEntry {
  id: string;
  text: string;
  gloss?: string;
  source?: string;
  error?: string;
}

export type PipelineErrorSource = "recognizer" | "translator" | "avatar";

export type PipelineEvents = {
  transcript: TranscriptSegment;
  gloss: GlossEntry;
  queue: SignQueueState;
  start: SignItem;
  end: SignItem;
  drop: SignItem[];
  error: { source: PipelineErrorSource; error: Error };
};

export interface PipelineOptions {
  translator: GlossTranslator;
  renderer: AvatarRenderer;
  queue?: Partial<SignQueueOptions>;
}

type Settled = { ok: true; result: GlossResult } | { ok: false; error: Error };

const toError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)));

/**
 * Liga as etapas: transcrição final → tradução para glosa → fila do avatar.
 * As traduções rodam em paralelo, mas entram na fila na ordem da fala.
 */
export class Pipeline extends Emitter<PipelineEvents> {
  readonly queue: SignQueue;
  translator: GlossTranslator;
  #order: Promise<void> = Promise.resolve();
  #textCount = 0;

  constructor({ translator, renderer, queue }: PipelineOptions) {
    super();
    this.translator = translator;
    this.queue = new SignQueue(renderer, queue);
    this.queue.on("state", (state) => this.emit("queue", state));
    this.queue.on("start", (item) => this.emit("start", item));
    this.queue.on("end", (item) => this.emit("end", item));
    this.queue.on("drop", (items) => this.emit("drop", items));
    this.queue.on("error", (error) => this.emit("error", { source: "avatar", error }));
  }

  /** Passa a ouvir um reconhecedor de fala. Retorna a função que desliga. */
  attach(recognizer: SpeechRecognizer): () => void {
    const unsubscribe = [
      recognizer.on("transcript", (segment) => {
        this.emit("transcript", segment);
        if (segment.isFinal) this.#translate(segment.id, segment.text);
      }),
      recognizer.on("error", (error) => this.emit("error", { source: "recognizer", error })),
    ];
    return () => {
      for (const off of unsubscribe) off();
    };
  }

  /** Traduz um texto digitado, como se fosse uma transcrição final. */
  submitText(text: string): string | undefined {
    const trimmed = text.trim();
    if (!trimmed) return undefined;
    const id = `texto-${++this.#textCount}`;
    this.emit("transcript", { id, text: trimmed, isFinal: true, timestamp: Date.now() });
    this.#translate(id, trimmed);
    return id;
  }

  /** Esvazia a fila e para o avatar. */
  clear(): void {
    this.queue.clear();
  }

  /** Resolve quando todas as traduções pendentes tiverem sido processadas. */
  idle(): Promise<void> {
    return this.#order;
  }

  #translate(id: string, text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    const settled: Promise<Settled> = this.translator.translate(trimmed).then(
      (result) => ({ ok: true, result }),
      (error: unknown) => ({ ok: false, error: toError(error) }),
    );
    this.#order = this.#order.then(async () => {
      const outcome = await settled;
      if (!outcome.ok) {
        this.emit("gloss", { id, text: trimmed, error: outcome.error.message });
        this.emit("error", { source: "translator", error: outcome.error });
        return;
      }
      const { gloss, source } = outcome.result;
      this.emit("gloss", { id, text: trimmed, gloss, source });
      if (countSigns(gloss) > 0) this.queue.enqueue({ id, text: trimmed, gloss });
    });
  }
}
