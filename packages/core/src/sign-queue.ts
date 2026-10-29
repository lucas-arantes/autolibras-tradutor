import { Emitter } from "./emitter";
import type { AvatarRenderer } from "./types";

export interface SignItem {
  id: string;
  /** Texto em português que originou a glosa. */
  text: string;
  gloss: string;
}

export interface SignQueueOptions {
  /** Duração estimada inicial de um sinal na velocidade 1, em segundos. */
  secondsPerSign: number;
  /** Ajusta a estimativa por sinal com a duração real de cada reprodução. */
  adaptive: boolean;
  /** Velocidade de reprodução quando a fila está em dia. */
  baseSpeed: number;
  /** Velocidade máxima de reprodução. */
  maxSpeed: number;
  /** Atraso (em velocidade 1) a partir do qual a reprodução acelera. */
  targetLagSeconds: number;
  /** Atraso máximo; acima dele os itens pendentes mais antigos são descartados. */
  maxLagSeconds: number;
}

export const DEFAULT_SIGN_QUEUE_OPTIONS: SignQueueOptions = {
  secondsPerSign: 1.5,
  adaptive: true,
  baseSpeed: 1,
  maxSpeed: 2,
  targetLagSeconds: 4,
  maxLagSeconds: 15,
};

export interface SignQueueState {
  current: SignItem | null;
  pending: readonly SignItem[];
  /** Atraso estimado, em segundos reais, até a fila esvaziar. */
  lagSeconds: number;
  speed: number;
  dropped: number;
  /** Estimativa atual da duração de um sinal na velocidade 1. */
  secondsPerSign: number;
}

/** Peso de cada nova medição na média móvel da duração por sinal. */
const ADAPT_WEIGHT = 0.3;
const MIN_SECONDS_PER_SIGN = 0.3;
const MAX_SECONDS_PER_SIGN = 6;

export type SignQueueEvents = {
  state: SignQueueState;
  start: SignItem;
  end: SignItem;
  drop: SignItem[];
  error: Error;
};

/** Número de sinais de uma glosa, ignorando marcadores como `[PONTO]`. */
export function countSigns(gloss: string): number {
  return gloss.split(/\s+/).filter((token) => token && !/^\[.*\]$/.test(token)).length;
}

/**
 * Fila de glosas para o avatar, com controle de vazão: acelera a reprodução
 * conforme o atraso cresce e descarta os itens mais antigos quando o atraso
 * passa do limite, para a sinalização não ficar cada vez mais distante da fala.
 */
export class SignQueue extends Emitter<SignQueueEvents> {
  readonly #renderer: AvatarRenderer;
  readonly #now: () => number;
  #options: SignQueueOptions;
  #pending: SignItem[] = [];
  #current: SignItem | null = null;
  #currentStartedAt = 0;
  #speed: number;
  #dropped = 0;
  #draining = false;
  #secondsPerSign: number;
  /** Incrementado por `clear()`, para não medir uma reprodução interrompida. */
  #generation = 0;

  constructor(
    renderer: AvatarRenderer,
    options: Partial<SignQueueOptions> = {},
    now: () => number = () => performance.now() / 1000,
  ) {
    super();
    this.#renderer = renderer;
    this.#now = now;
    this.#options = { ...DEFAULT_SIGN_QUEUE_OPTIONS, ...options };
    this.#speed = this.#options.baseSpeed;
    this.#secondsPerSign = this.#options.secondsPerSign;
  }

  get options(): Readonly<SignQueueOptions> {
    return this.#options;
  }

  get state(): SignQueueState {
    const nominal = this.#nominalLag();
    return {
      current: this.#current,
      pending: [...this.#pending],
      lagSeconds: nominal / this.#speedFor(nominal),
      speed: this.#speed,
      dropped: this.#dropped,
      secondsPerSign: this.#secondsPerSign,
    };
  }

  setOptions(options: Partial<SignQueueOptions>): void {
    this.#options = { ...this.#options, ...options };
    if (options.secondsPerSign !== undefined) this.#secondsPerSign = options.secondsPerSign;
    this.#emitState();
  }

  enqueue(item: SignItem): void {
    this.#pending.push(item);
    this.#dropExcess();
    this.#emitState();
    void this.#drain();
  }

  /** Esvazia a fila e interrompe o sinal atual. */
  clear(): void {
    this.#pending = [];
    this.#generation++;
    this.#renderer.stop();
    this.#emitState();
  }

  #estimate(item: SignItem): number {
    return countSigns(item.gloss) * this.#secondsPerSign;
  }

  /** Atualiza a média móvel da duração por sinal com uma reprodução completa. */
  #learn(item: SignItem, elapsedSeconds: number, speed: number): void {
    const signs = countSigns(item.gloss);
    if (!this.#options.adaptive || signs === 0 || elapsedSeconds <= 0) return;
    const observed = Math.min(
      MAX_SECONDS_PER_SIGN,
      Math.max(MIN_SECONDS_PER_SIGN, (elapsedSeconds * speed) / signs),
    );
    this.#secondsPerSign += (observed - this.#secondsPerSign) * ADAPT_WEIGHT;
  }

  /** Atraso total medido em segundos de sinalização na velocidade 1. */
  #nominalLag(): number {
    let lag = this.#pending.reduce((sum, item) => sum + this.#estimate(item), 0);
    if (this.#current) {
      const played = (this.#now() - this.#currentStartedAt) * this.#speed;
      lag += Math.max(0, this.#estimate(this.#current) - played);
    }
    return lag;
  }

  #speedFor(nominalLag: number): number {
    const { baseSpeed, maxSpeed, targetLagSeconds, maxLagSeconds } = this.#options;
    if (nominalLag <= targetLagSeconds) return baseSpeed;
    if (nominalLag >= maxLagSeconds) return maxSpeed;
    const ratio = (nominalLag - targetLagSeconds) / (maxLagSeconds - targetLagSeconds);
    return Math.round((baseSpeed + (maxSpeed - baseSpeed) * ratio) * 100) / 100;
  }

  #dropExcess(): void {
    const dropped: SignItem[] = [];
    while (this.#pending.length > 1 && this.#nominalLag() > this.#options.maxLagSeconds) {
      const item = this.#pending.shift();
      if (item) dropped.push(item);
    }
    if (dropped.length === 0) return;
    this.#dropped += dropped.length;
    this.emit("drop", dropped);
  }

  async #drain(): Promise<void> {
    if (this.#draining) return;
    this.#draining = true;
    try {
      let item = this.#pending.shift();
      while (item) {
        const speed = this.#speedFor(this.#nominalLag() + this.#estimate(item));
        if (speed !== this.#speed) {
          this.#speed = speed;
          this.#renderer.setSpeed(speed);
        }
        this.#current = item;
        this.#currentStartedAt = this.#now();
        const generation = this.#generation;
        this.emit("start", item);
        this.#emitState();
        try {
          await this.#renderer.play(item.gloss);
          if (generation === this.#generation) {
            this.#learn(item, this.#now() - this.#currentStartedAt, speed);
          }
        } catch (error) {
          this.emit("error", error instanceof Error ? error : new Error(String(error)));
        }
        this.#current = null;
        this.emit("end", item);
        this.#emitState();
        item = this.#pending.shift();
      }
    } finally {
      this.#draining = false;
    }
  }

  #emitState(): void {
    this.emit("state", this.state);
  }
}
