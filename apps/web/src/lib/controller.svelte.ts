import {
  FallbackTranslator,
  type GlossTranslator,
  Pipeline,
  type RecognizerState,
} from "@autolibras/core";
import { RulesTranslator } from "@autolibras/gloss-rules";
import { WebSpeechRecognizer } from "@autolibras/stt-web";
import { VLibrasApiTranslator, VLibrasWidgetRenderer } from "@autolibras/vlibras";
import { loadSettings, type Settings, saveSettings, type TranslatorMode } from "./settings";

export type EntryStatus =
  | "traduzindo"
  | "na fila"
  | "sinalizando"
  | "concluído"
  | "descartado"
  | "sem sinais"
  | "erro";

export interface Entry {
  id: string;
  text: string;
  gloss?: string;
  source?: string;
  error?: string;
  status: EntryStatus;
}

export type AvatarStatus = "carregando" | "pronto" | "erro";

const MAX_ENTRIES = 50;

function createTranslator(mode: TranslatorMode): GlossTranslator {
  const rules = new RulesTranslator();
  return mode === "vlibras" ? new FallbackTranslator([new VLibrasApiTranslator(), rules]) : rules;
}

/** Estado reativo do app e ligação entre reconhecedor, pipeline e avatar. */
export class TranslatorController {
  readonly speechSupported = WebSpeechRecognizer.isSupported();
  settings = $state<Settings>(loadSettings());
  micState = $state<RecognizerState>("idle");
  listening = $state(false);
  partial = $state("");
  entries = $state<Entry[]>([]);
  avatarStatus = $state<AvatarStatus>("carregando");
  lagSeconds = $state(0);
  speed = $state(1);
  dropped = $state(0);
  pending = $state(0);
  lastError = $state<string | null>(null);

  readonly #recognizer = new WebSpeechRecognizer();
  readonly #renderer: VLibrasWidgetRenderer;
  readonly #pipeline: Pipeline;

  constructor() {
    this.#renderer = new VLibrasWidgetRenderer({ avatar: this.settings.avatar });
    this.#pipeline = new Pipeline({
      translator: createTranslator(this.settings.translator),
      renderer: this.#renderer,
      queue: { maxLagSeconds: this.settings.maxLagSeconds, baseSpeed: this.settings.baseSpeed },
    });
    this.#pipeline.attach(this.#recognizer);
    this.#bindEvents();
  }

  async loadAvatar(): Promise<void> {
    this.avatarStatus = "carregando";
    try {
      await this.#renderer.load();
      this.#renderer.setSpeed(this.settings.baseSpeed);
      this.avatarStatus = "pronto";
    } catch (error) {
      this.avatarStatus = "erro";
      this.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  toggleListening(): void {
    if (this.listening) {
      this.listening = false;
      this.#recognizer.stop();
      this.partial = "";
    } else {
      this.lastError = null;
      this.listening = true;
      this.#recognizer.start();
    }
  }

  submitText(text: string): boolean {
    return this.#pipeline.submitText(text) !== undefined;
  }

  clearQueue(): void {
    this.#pipeline.clear();
    for (const entry of this.entries) {
      if (entry.status === "na fila" || entry.status === "sinalizando") entry.status = "descartado";
    }
  }

  clearHistory(): void {
    this.entries = this.entries.filter((e) => e.status === "na fila" || e.status === "sinalizando");
  }

  updateSettings(changes: Partial<Settings>): void {
    const previous = this.settings;
    this.settings = { ...previous, ...changes };
    saveSettings(this.settings);
    if (changes.translator && changes.translator !== previous.translator) {
      this.#pipeline.translator = createTranslator(changes.translator);
    }
    if (changes.avatar && changes.avatar !== previous.avatar) {
      this.#renderer.setAvatar(changes.avatar);
    }
    if (changes.maxLagSeconds !== undefined || changes.baseSpeed !== undefined) {
      this.#pipeline.queue.setOptions({
        maxLagSeconds: this.settings.maxLagSeconds,
        baseSpeed: this.settings.baseSpeed,
        maxSpeed: Math.max(2, this.settings.baseSpeed),
      });
    }
  }

  #entry(id: string): Entry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  #setStatus(id: string, status: EntryStatus): void {
    const entry = this.#entry(id);
    if (entry) entry.status = status;
  }

  #bindEvents(): void {
    const pipeline = this.#pipeline;

    this.#recognizer.on("state", (state) => {
      this.micState = state;
      if (state === "error") this.listening = false;
    });

    pipeline.on("transcript", (segment) => {
      if (!segment.isFinal) {
        this.partial = segment.text;
        return;
      }
      this.partial = "";
      this.entries = [
        { id: segment.id, text: segment.text, status: "traduzindo" as const },
        ...this.entries,
      ].slice(0, MAX_ENTRIES);
    });

    pipeline.on("gloss", ({ id, gloss, source, error }) => {
      const entry = this.#entry(id);
      if (!entry) return;
      entry.gloss = gloss;
      entry.source = source;
      entry.error = error;
      entry.status = error ? "erro" : gloss?.trim() ? "na fila" : "sem sinais";
    });

    pipeline.on("start", (item) => this.#setStatus(item.id, "sinalizando"));
    pipeline.on("end", (item) => {
      if (this.#entry(item.id)?.status === "sinalizando") this.#setStatus(item.id, "concluído");
    });
    pipeline.on("drop", (items) => {
      for (const item of items) this.#setStatus(item.id, "descartado");
    });

    pipeline.on("queue", (state) => {
      this.lagSeconds = state.lagSeconds;
      this.speed = state.speed;
      this.dropped = state.dropped;
      this.pending = state.pending.length + (state.current ? 1 : 0);
    });

    pipeline.on("error", ({ source, error }) => {
      const prefix = { recognizer: "Microfone", translator: "Tradução", avatar: "Avatar" }[source];
      this.lastError = `${prefix}: ${error.message}`;
    });
  }
}
