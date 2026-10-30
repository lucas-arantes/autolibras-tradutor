import { type AvatarRenderer, Emitter, type GlossTranslator, Pipeline } from "@autolibras/core";
import { RulesTranslator } from "@autolibras/gloss-rules";
import { CueFollower, pickTrack, type TrackLike } from "./follower";

export interface ClosedSigningOptions {
  /** Pacote de sinais do avatar próprio (pasta com `manifest.json`). */
  signs: string;
  /** Elemento sobre o qual o avatar aparece; padrão: o pai do `<video>`. */
  container?: HTMLElement;
  /** Canto do vídeo onde fica o avatar. */
  position?: "right" | "left";
  /** Altura do avatar, como fração da altura do vídeo (padrão: 0,5). */
  size?: number;
  /** Faixa de legenda a seguir; padrão: a de português, ou a primeira. */
  track?: TextTrack;
  /** Idioma preferido ao escolher a faixa (padrão: `pt`). */
  language?: string;
  /** Tradutor de português para glosa; padrão: regras locais, sem enviar texto a servidores. */
  translator?: GlossTranslator;
  /**
   * Baixa a lista de sinais do VLibras para as regras reconhecerem mais palavras
   * (padrão: sim). Só vale para o tradutor padrão.
   */
  vocabulary?: boolean;
  /** Cria o avatar; padrão: o avatar VRM do AutoLibras com fundo transparente. */
  createRenderer?: (canvas: HTMLCanvasElement) => Promise<AvatarRenderer>;
}

export type ClosedSigningEvents = {
  /** Ligou ou desligou. */
  toggle: boolean;
  /** Frase que entrou na fila do avatar. */
  sentence: string;
  error: Error;
};

const toError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)));

async function defaultRenderer(canvas: HTMLCanvasElement, signs: string): Promise<AvatarRenderer> {
  const { createVrmRenderer } = await import("@autolibras/avatar-three");
  return createVrmRenderer({ canvas, signs, background: null });
}

async function defaultTranslator(vocabulary: boolean): Promise<GlossTranslator> {
  const rules = new RulesTranslator();
  if (vocabulary) {
    const { loadVLibrasVocabulary } = await import("@autolibras/vlibras");
    loadVLibrasVocabulary()
      .then((words) => rules.setVocabulary(words))
      .catch(() => undefined);
  }
  return rules;
}

/**
 * "Closed signing": Libras sob demanda num player de vídeo, como a legenda
 * oculta. O avatar sinaliza a legenda em português do vídeo, no tempo dela.
 * Segue as `textTracks` do `<video>`, onde também ficam as legendas de players
 * como o hls.js e o video.js.
 */
export class ClosedSigning extends Emitter<ClosedSigningEvents> {
  readonly video: HTMLVideoElement;
  readonly #options: ClosedSigningOptions;
  readonly #follower: CueFollower;
  readonly #layer: HTMLDivElement;
  readonly #canvas: HTMLCanvasElement;
  readonly #resize: ResizeObserver | null;
  #pipeline?: Pipeline;
  #renderer?: AvatarRenderer;
  #starting?: Promise<void>;
  #enabled = false;
  readonly #onSeeking = () => this.#restart();
  readonly #onTracks = () => {
    if (this.#enabled && !this.#follower.track) this.#follower.follow(this.#pickTrack());
  };

  constructor(video: HTMLVideoElement, options: ClosedSigningOptions) {
    super();
    this.video = video;
    this.#options = options;
    this.#follower = new CueFollower((sentence) => {
      this.emit("sentence", sentence);
      this.#pipeline?.submitText(sentence);
    });

    const container = options.container ?? video.parentElement;
    if (!container) throw new Error("O vídeo precisa estar dentro de um elemento");
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    this.#layer = document.createElement("div");
    this.#layer.className = "autolibras-closed-signing";
    Object.assign(this.#layer.style, {
      position: "absolute",
      bottom: "0",
      [options.position === "left" ? "left" : "right"]: "0",
      pointerEvents: "none",
      display: "none",
      zIndex: "2",
    });
    this.#canvas = document.createElement("canvas");
    this.#canvas.setAttribute("aria-label", "Avatar sinalizando a legenda em Libras");
    Object.assign(this.#canvas.style, { width: "100%", height: "100%", display: "block" });
    this.#layer.append(this.#canvas);
    container.append(this.#layer);
    this.#resize =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => this.#layout());
    this.#resize?.observe(video);
    this.#layout();
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  /** Liga o avatar. Na primeira vez, carrega o modelo e o pacote de sinais. */
  async enable(): Promise<void> {
    if (this.#enabled) return;
    this.#enabled = true;
    this.#layer.style.display = "block";
    this.emit("toggle", true);
    try {
      this.#starting ??= this.#start();
      await this.#starting;
    } catch (error) {
      this.#starting = undefined;
      this.disable();
      this.emit("error", toError(error));
      return;
    }
    if (!this.#enabled) return;
    this.video.addEventListener("seeking", this.#onSeeking);
    this.video.textTracks?.addEventListener?.("addtrack", this.#onTracks);
    this.#follower.follow(this.#pickTrack());
  }

  disable(): void {
    if (!this.#enabled) return;
    this.#enabled = false;
    this.#layer.style.display = "none";
    this.#follower.stop();
    this.#pipeline?.clear();
    this.video.removeEventListener("seeking", this.#onSeeking);
    this.video.textTracks?.removeEventListener?.("addtrack", this.#onTracks);
    this.emit("toggle", false);
  }

  toggle(): Promise<void> {
    if (this.#enabled) {
      this.disable();
      return Promise.resolve();
    }
    return this.enable();
  }

  /** Botão "Libras" para a barra do player; mostra se o avatar está ligado. */
  createButton(label = "Libras"): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "autolibras-closed-signing-button";
    button.textContent = label;
    button.title = "Mostrar ou esconder o avatar de Libras";
    button.setAttribute("aria-pressed", String(this.#enabled));
    button.addEventListener("click", () => void this.toggle());
    this.on("toggle", (on) => button.setAttribute("aria-pressed", String(on)));
    return button;
  }

  destroy(): void {
    this.disable();
    this.#resize?.disconnect();
    this.#layer.remove();
    (this.#renderer as { dispose?: () => void } | undefined)?.dispose?.();
  }

  async #start(): Promise<void> {
    const { createRenderer, signs, translator, vocabulary = true } = this.#options;
    const renderer = await (createRenderer
      ? createRenderer(this.#canvas)
      : defaultRenderer(this.#canvas, signs));
    await renderer.load();
    this.#renderer = renderer;
    this.#pipeline = new Pipeline({
      translator: translator ?? (await defaultTranslator(vocabulary)),
      renderer,
    });
    this.#pipeline.on("error", ({ error }) => this.emit("error", error));
  }

  #pickTrack(): TrackLike | null {
    return (
      (this.#options.track as TrackLike | undefined) ??
      pickTrack(this.video.textTracks as unknown as ArrayLike<TrackLike>, this.#options.language)
    );
  }

  /** O vídeo pulou: o que estava na fila não vale mais. */
  #restart(): void {
    this.#pipeline?.clear();
    this.#follower.reset();
  }

  #layout(): void {
    const height = (this.video.clientHeight || 360) * (this.#options.size ?? 0.5);
    this.#layer.style.height = `${Math.round(height)}px`;
    this.#layer.style.width = `${Math.round((height * 2) / 3)}px`;
  }
}

/** Liga o "closed signing" a um `<video>`. Começa desligado: chame `enable()` ou use o botão. */
export function attachClosedSigning(
  video: HTMLVideoElement,
  options: ClosedSigningOptions,
): ClosedSigning {
  return new ClosedSigning(video, options);
}
