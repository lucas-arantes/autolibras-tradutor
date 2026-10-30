import {
  FallbackTranslator,
  type GlossTranslator,
  Pipeline,
  type RecognizerState,
  type SpeechRecognizer,
} from "@autolibras/core";
import { RulesTranslator } from "@autolibras/gloss-rules";
import { RemoteWhisperRecognizer, WebSpeechRecognizer } from "@autolibras/stt-web";
import {
  loadVLibrasVocabulary,
  VLibrasApiTranslator,
  type VLibrasAvatar,
} from "@autolibras/vlibras";
import { type AvatarHandle, type AvatarKind, createAvatar, SwitchableRenderer } from "./avatar";
import {
  loadSettings,
  type RecognizerMode,
  type Settings,
  saveSettings,
  signsUrlOf,
  type TranslatorMode,
} from "./settings";

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

// Uma instância só: recebe o dicionário de sinais quando ele termina de carregar.
const rules = new RulesTranslator();

function createTranslator(mode: TranslatorMode): GlossTranslator {
  return mode === "vlibras" ? new FallbackTranslator([new VLibrasApiTranslator(), rules]) : rules;
}

function createRecognizer(mode: RecognizerMode, whisperUrl: string): SpeechRecognizer {
  return mode === "whisper"
    ? new RemoteWhisperRecognizer({ url: whisperUrl })
    : new WebSpeechRecognizer();
}

/** Estado reativo do app e ligação entre reconhecedor, pipeline e avatar. */
export class TranslatorController {
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
  /** Avatar em uso (pode diferir da configuração se faltar o pacote de sinais). */
  avatarKind = $state<AvatarKind>("vlibras");
  /** Canvas do avatar próprio, para a página mostrar; `null` com o VLibras. */
  avatarCanvas = $state.raw<HTMLCanvasElement | null>(null);

  #recognizer!: SpeechRecognizer;
  #detachRecognizer = () => {};
  readonly #renderer = new SwitchableRenderer();
  readonly #pipeline: Pipeline;
  #avatar?: AvatarHandle;
  #avatarSigns = "";
  #avatarRequest = 0;

  get speechSupported(): boolean {
    return this.settings.recognizer === "whisper"
      ? RemoteWhisperRecognizer.isSupported()
      : WebSpeechRecognizer.isSupported();
  }

  constructor() {
    this.#pipeline = new Pipeline({
      translator: createTranslator(this.settings.translator),
      renderer: this.#renderer,
      queue: { maxLagSeconds: this.settings.maxLagSeconds, baseSpeed: this.settings.baseSpeed },
    });
    this.#useRecognizer();
    this.#bindEvents();
    // O dicionário melhora as regras locais; sem ele, elas funcionam do mesmo jeito.
    loadVLibrasVocabulary()
      .then((vocabulary) => rules.setVocabulary(vocabulary))
      .catch(() => undefined);
  }

  /** Troca o reconhecedor de fala conforme a configuração, parando o anterior. */
  #useRecognizer(): void {
    if (this.listening) {
      this.#recognizer.stop();
      this.listening = false;
      this.partial = "";
    }
    this.#detachRecognizer();
    const recognizer = createRecognizer(this.settings.recognizer, this.settings.whisperUrl);
    const detachPipeline = this.#pipeline.attach(recognizer);
    const detachState = recognizer.on("state", (state) => {
      this.micState = state;
      if (state === "error") this.listening = false;
    });
    this.#detachRecognizer = () => {
      detachPipeline();
      detachState();
    };
    this.#recognizer = recognizer;
    this.micState = "idle";
  }

  /** Avatar a usar: o configurado, ou o VLibras se o próprio não tiver pacote de sinais. */
  get #wantedAvatar(): AvatarKind {
    return this.settings.avatarKind === "propio" && signsUrlOf(this.settings)
      ? "propio"
      : "vlibras";
  }

  /** Cria (ou troca) o avatar conforme a configuração e espera ele carregar. */
  async loadAvatar(): Promise<void> {
    const request = ++this.#avatarRequest;
    this.avatarStatus = "carregando";
    try {
      const kind = this.#wantedAvatar;
      const signsUrl = kind === "propio" ? signsUrlOf(this.settings) : "";
      // Um pacote novo precisa de um avatar novo (o renderer guarda o manifest).
      if (this.#avatar?.kind !== kind || this.#avatarSigns !== signsUrl) {
        const handle = await createAvatar(kind, { vlibrasAvatar: this.settings.avatar, signsUrl });
        if (request !== this.#avatarRequest) {
          handle.dispose();
          return;
        }
        this.#avatar?.dispose();
        this.#avatar = handle;
        this.#avatarSigns = signsUrl;
        this.#renderer.use(handle.renderer);
        this.avatarKind = kind;
        this.avatarCanvas = handle.canvas;
      }
      await this.#renderer.load();
      if (request !== this.#avatarRequest) return;
      this.#renderer.setSpeed(this.settings.baseSpeed);
      this.avatarStatus = "pronto";
    } catch (error) {
      if (request !== this.#avatarRequest) return;
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
    if (
      (changes.recognizer && changes.recognizer !== previous.recognizer) ||
      (changes.whisperUrl !== undefined && changes.whisperUrl !== previous.whisperUrl)
    ) {
      this.#useRecognizer();
    }
    if (changes.translator && changes.translator !== previous.translator) {
      this.#pipeline.translator = createTranslator(changes.translator);
    }
    if (changes.avatar && changes.avatar !== previous.avatar) {
      const renderer = this.#avatar?.renderer as { setAvatar?: (a: VLibrasAvatar) => void };
      renderer?.setAvatar?.(changes.avatar);
    }
    if (
      (changes.avatarKind && changes.avatarKind !== previous.avatarKind) ||
      (changes.signsUrl !== undefined && changes.signsUrl !== previous.signsUrl)
    ) {
      void this.loadAvatar();
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
