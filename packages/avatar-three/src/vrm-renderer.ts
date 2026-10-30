import { type AvatarRenderer, Emitter } from "@autolibras/core";
import { Quaternion } from "three";
import type { ContactSample } from "./contacts";
import { applyBreathing, applyHandShift, applyHeadTurn, copyPose, TimelinePlayer } from "./player";
import { type FaceChannel, type Pose, type SignClip, SignPack } from "./sign-pack";
import {
  type ExpressionCueName,
  planGloss,
  type Segment,
  type SignUnit,
  type Timeline,
  type TimelineOptions,
} from "./timeline";

/** Ligação com o mundo 3D: o renderer só calcula poses, o palco as desenha. */
export interface AvatarStage {
  load(): Promise<void>;
  /** Expressões que o modelo tem (nomes VRM). */
  readonly expressionNames: readonly string[];
  /** Aplica pose, contatos (IK) e expressões e desenha um quadro. */
  render(
    pose: Pose,
    expressions: ReadonlyMap<string, number>,
    dt: number,
    contacts?: readonly ContactSample[],
  ): void;
  /** Chama `tick(dt)` a cada quadro e devolve a função que para o laço. */
  start(tick: (dt: number) => void): () => void;
  /** Troca o fundo; `null` deixa transparente (opcional). */
  setBackground?(background: string | null): void;
  dispose(): void;
}

/** Expressões VRM usadas para cada pista, em ordem de preferência. */
export const EXPRESSION_FALLBACKS: Record<ExpressionCueName, string[]> = {
  browUp: ["browUp", "surprised"],
  browDown: ["browDown", "angry"],
  surprised: ["surprised", "happy"],
  intense: ["browDown", "angry"],
};

/**
 * Expressões VRM para cada canal do rosto gravado nos clipes, em ordem de preferência,
 * com o ganho de cada uma. O modelo do AutoLibras tem todas as primeiras; outros VRMs
 * caem nas alternativas mais próximas que tiverem (ou ignoram o canal).
 */
export const FACE_EXPRESSIONS: Record<FaceChannel, Array<[string, number]>> = {
  browRaise: [
    ["browUp", 1],
    ["surprised", 0.5],
  ],
  browOuterUp: [
    ["browUp", 0.7],
    ["surprised", 0.35],
  ],
  browLower: [
    ["browDown", 0.8],
    ["angry", 0.4],
  ],
  browFrown: [
    ["browDown", 0.9],
    ["angry", 0.5],
  ],
  browAngry: [
    ["browDown", 0.7],
    ["angry", 0.4],
  ],
  smile: [
    ["mouthSmile", 1],
    ["happy", 0.7],
  ],
  frown: [
    ["mouthFrown", 1],
    ["sad", 0.6],
  ],
  pucker: [
    ["mouthPucker", 0.9],
    ["ou", 0.7],
  ],
  lipPress: [["mouthPress", 1]],
  upperLip: [],
  cheekPuff: [["cheekPuff", 1]],
  cheekSuck: [
    ["cheekSuck", 1],
    ["ou", 0.4],
  ],
  jawOpen: [["aa", 0.8]],
};

/** Canais de sobrancelha: cedem lugar às pistas gramaticais de pergunta. */
const BROW_CHANNELS = new Set<FaceChannel>([
  "browRaise",
  "browOuterUp",
  "browLower",
  "browFrown",
  "browAngry",
]);
const BROW_CUES = new Set<ExpressionCueName>(["browUp", "browDown"]);

export interface SignEvent {
  unit: SignUnit;
  index: number;
  total: number;
}

export type VrmRendererEvents = {
  /** Começou um sinal, uma letra ou um placeholder. */
  sign: SignEvent;
  /** Linha do tempo pronta, antes de começar a tocar. */
  plan: Timeline;
  /** Falha ao baixar clipes (o sinal vira placeholder). */
  error: Error;
};

export interface VrmRendererOptions {
  /** Pacote de sinais ou a URL base dele (onde está o `manifest.json`). */
  signs: SignPack | string;
  stage: AvatarStage;
  timeline?: Partial<TimelineOptions>;
  /** Tempo para voltar ao repouso depois de `stop()` (constante da suavização, s). */
  settleSeconds?: number;
  /** Corrige os contatos das mãos com IK (padrão: sim). */
  contacts?: boolean;
  /** Respiração sutil, também durante a sinalização (padrão: sim). */
  breathing?: boolean;
  /**
   * Peso das expressões gravadas nos clipes (boca, bochechas, sobrancelhas), de 0 a 1
   * (padrão: 1). Zero deixa só as pistas gramaticais (perguntas, negação).
   */
  faceWeight?: number;
}

interface ActivePlay {
  id: number;
  player: TimelinePlayer;
  time: number;
  segment: Segment | undefined;
  resolve: () => void;
}

const MIN_SPEED = 0.25;
const MAX_SPEED = 3;

/**
 * Avatar próprio: modelo VRM, clipes de sinais carregados por URL, crossfade entre
 * sinais e expressões faciais numa pista separada. `play` resolve quando a sinalização
 * termina, é interrompida por `stop()` ou substituída por outro `play`.
 */
export class VrmRenderer extends Emitter<VrmRendererEvents> implements AvatarRenderer {
  readonly name = "vrm";
  readonly pack: SignPack;
  readonly #stage: AvatarStage;
  readonly #timelineOptions: Partial<TimelineOptions>;
  readonly #settle: number;
  #contacts: boolean;
  #loading?: Promise<void>;
  #stopLoop?: () => void;
  #speed = 1;
  #playId = 0;
  #active?: ActivePlay;
  readonly #pose: Pose = new Map();
  /** Pose entregue ao palco: `#pose` mais a respiração. */
  readonly #out: Pose = new Map();
  #clock = 0;
  #breathing: boolean;
  readonly #rest: Pose = new Map();
  #expressionMap = new Map<ExpressionCueName, string>();
  #faceMap = new Map<FaceChannel, [string, number]>();
  #faceWeight: number;

  constructor(options: VrmRendererOptions) {
    super();
    this.pack = typeof options.signs === "string" ? new SignPack(options.signs) : options.signs;
    this.#stage = options.stage;
    this.#timelineOptions = options.timeline ?? {};
    this.#settle = options.settleSeconds ?? 0.12;
    this.#contacts = options.contacts ?? true;
    this.#breathing = options.breathing ?? true;
    this.#faceWeight = clamp01(options.faceWeight ?? 1);
  }

  get speed(): number {
    return this.#speed;
  }

  get playing(): boolean {
    return this.#active !== undefined;
  }

  load(): Promise<void> {
    this.#loading ??= this.#load().catch((error: unknown) => {
      this.#loading = undefined;
      throw error;
    });
    return this.#loading;
  }

  async #load(): Promise<void> {
    await Promise.all([this.pack.load(), this.#stage.load()]);
    const available = new Set(this.#stage.expressionNames);
    for (const [cue, names] of Object.entries(EXPRESSION_FALLBACKS)) {
      const name = names.find((n) => available.has(n));
      if (name) this.#expressionMap.set(cue as ExpressionCueName, name);
    }
    for (const [channel, options] of Object.entries(FACE_EXPRESSIONS)) {
      const found = options.find(([n]) => available.has(n));
      if (found) this.#faceMap.set(channel as FaceChannel, found);
    }
    const rest = this.pack.rest;
    if (rest) {
      const clip = await this.pack.clip(rest);
      clip.sample(0, this.#rest);
      copyPose(this.#rest, this.#pose);
    }
    this.#stopLoop = this.#stage.start((dt) => this.#tick(dt));
  }

  async play(gloss: string): Promise<void> {
    await this.load();
    const id = ++this.#playId;
    this.#finish();
    const timeline = planGloss(gloss, this.pack, this.#timelineOptions);
    if (timeline.segments.length === 0) return;
    const clips = await this.#loadClips(timeline);
    if (id !== this.#playId) return;
    this.emit("plan", timeline);
    await new Promise<void>((resolve) => {
      this.#active = {
        id,
        player: new TimelinePlayer(timeline, clips, this.#pose),
        time: 0,
        segment: undefined,
        resolve,
      };
    });
  }

  async #loadClips(timeline: Timeline): Promise<Map<string, SignClip>> {
    const names = [...new Set(timeline.segments.map((s) => s.clip).filter((c) => c !== null))];
    const results = await Promise.allSettled(names.map((name) => this.pack.clip(name)));
    const clips = new Map<string, SignClip>();
    results.forEach((result, i) => {
      const name = names[i];
      if (result.status === "fulfilled" && name) clips.set(name, result.value);
      else if (result.status === "rejected") {
        this.emit(
          "error",
          result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
        );
      }
    });
    return clips;
  }

  stop(): void {
    this.#playId++;
    this.#finish();
  }

  setSpeed(speed: number): void {
    if (!Number.isFinite(speed)) return;
    this.#speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
  }

  /** Troca o fundo do palco; `null` ou `"transparent"` deixam o canvas transparente. */
  setBackground(background: string | null): void {
    this.#stage.setBackground?.(background);
  }

  /** Peso das expressões gravadas nos clipes (0 desliga, 1 é o padrão). */
  setFaceWeight(weight: number): void {
    if (Number.isFinite(weight)) this.#faceWeight = clamp01(weight);
  }

  /** Liga ou desliga a correção de contatos (útil para comparar). */
  setContacts(enabled: boolean): void {
    this.#contacts = enabled;
  }

  /** Para o laço de desenho e libera o palco. */
  dispose(): void {
    this.stop();
    this.#stopLoop?.();
    this.#stopLoop = undefined;
    this.#stage.dispose();
    this.#loading = undefined;
  }

  #finish(): void {
    const active = this.#active;
    this.#active = undefined;
    active?.resolve();
  }

  #tick(dt: number): void {
    const expressions = new Map<string, number>();
    let contacts: ContactSample[] = [];
    const active = this.#active;
    if (active) {
      active.time += dt * this.#speed;
      const frame = active.player.sample(active.time, this.#pose);
      if (frame.segment && frame.segment !== active.segment) {
        active.segment = frame.segment;
        const { segments } = active.player.timeline;
        this.emit("sign", {
          unit: frame.segment.unit,
          index: segments.indexOf(frame.segment),
          total: segments.length,
        });
      }
      applyHeadTurn(this.#pose, frame.headYaw, frame.headPitch);
      applyHandShift(this.#pose, frame.handShift);
      if (this.#contacts) contacts = frame.contacts;
      let browCue = 0;
      for (const [cue, weight] of frame.expressions) {
        if (BROW_CUES.has(cue)) browCue = Math.max(browCue, weight);
        const name = this.#expressionMap.get(cue);
        if (name) expressions.set(name, Math.max(weight, expressions.get(name) ?? 0));
      }
      // Expressões do próprio sinal. Numa pergunta, as sobrancelhas seguem a gramática
      // da frase, e as do sinal só entram no que sobrar.
      for (const [channel, weight] of frame.face) {
        const target = this.#faceMap.get(channel);
        if (!target) continue;
        const [name, gain] = target;
        const scale = BROW_CHANNELS.has(channel) ? 1 - browCue : 1;
        const w = weight * gain * scale * this.#faceWeight;
        if (w > 1e-3) expressions.set(name, Math.min(1, Math.max(w, expressions.get(name) ?? 0)));
      }
      if (active.time >= active.player.duration && active.id === this.#playId) this.#finish();
    } else {
      // Sem sinal: volta suavemente ao repouso (depois de `stop()`, por exemplo).
      const k = 1 - Math.exp(-dt / this.#settle);
      for (const [bone, rest] of this.#rest) {
        const q = this.#pose.get(bone);
        if (q) q.slerp(rest, k);
        else this.#pose.set(bone, rest.clone());
      }
      for (const [bone, q] of this.#pose) {
        if (!this.#rest.has(bone)) q.slerp(IDENTITY, k);
      }
    }
    this.#clock += dt;
    copyPose(this.#pose, this.#out);
    if (this.#breathing) applyBreathing(this.#out, this.#clock);
    this.#stage.render(this.#out, expressions, dt, contacts);
  }
}

const IDENTITY = new Quaternion();

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
