import { Quaternion, Vector3 } from "three";
import type { ContactSample } from "./contacts";
import type { FaceChannel, Pose, SignClip } from "./sign-pack";
import type { ExpressionCueName, Segment, Timeline } from "./timeline";

/** Suaviza o início e o fim do crossfade. */
export function smoothstep(u: number): number {
  const x = Math.min(Math.max(u, 0), 1);
  return x * x * (3 - 2 * x);
}

/** Interpola duas poses osso a osso com slerp; ossos ausentes contam como repouso. */
export function blendPoses(a: Pose, b: Pose, weight: number, out: Pose): Pose {
  const identity = IDENTITY;
  const bones = new Set([...a.keys(), ...b.keys()]);
  for (const bone of bones) {
    const qa = a.get(bone) ?? identity;
    const qb = b.get(bone) ?? identity;
    let q = out.get(bone);
    if (!q) {
      q = new Quaternion();
      out.set(bone, q);
    }
    // `slerpQuaternions` escolhe o caminho mais curto (corrige o sinal do quaternion).
    q.slerpQuaternions(qa, qb, weight);
  }
  return out;
}

export function copyPose(source: Pose, out: Pose = new Map()): Pose {
  for (const [bone, q] of source) {
    const target = out.get(bone);
    if (target) target.copy(q);
    else out.set(bone, q.clone());
  }
  return out;
}

const IDENTITY = new Quaternion();
const UP = new Vector3(0, 1, 0);
const RIGHT = new Vector3(1, 0, 0);
const FORWARD = new Vector3(0, 0, 1);
/** Respiração: período (s) e amplitude (rad) de cada osso, sobre o eixo indicado. */
const BREATH_PERIOD = 4.2;
const BREATH: Array<[string, Vector3, number]> = [
  ["spine", RIGHT, -0.01],
  ["upperChest", RIGHT, -0.012],
  ["head", RIGHT, 0.012],
  ["leftShoulder", FORWARD, 0.025],
  ["rightShoulder", FORWARD, -0.025],
];
const ENVELOPE = 0.15;

/** Fade de entrada e saída de uma pista de expressão ou de cabeça. */
function envelope(t: number, start: number, end: number): number {
  if (t <= start || t >= end) return 0;
  const ramp = Math.min(ENVELOPE, (end - start) / 2);
  return smoothstep((t - start) / ramp) * smoothstep((end - t) / ramp);
}

export interface PlayerFrame {
  segment: Segment | undefined;
  /** Pesos das expressões (nomes das pistas, não do VRM). */
  expressions: Map<ExpressionCueName, number>;
  /** Expressões gravadas nos próprios clipes (canais do rosto, já com o crossfade). */
  face: Map<FaceChannel, number>;
  /** Giro da cabeça (rad) para os lados, do movimento de negação. */
  headYaw: number;
  /** Inclinação da cabeça (rad, positivo abaixa o queixo), das perguntas. */
  headPitch: number;
  /** Deslocamento lateral da mão dominante (0 a 1), em letras repetidas. */
  handShift: number;
  /** Contatos das mãos a corrigir com IK (já com os pesos do crossfade). */
  contacts: ContactSample[];
}

/**
 * Toca uma linha do tempo: amostra o clipe do segmento ativo e faz o crossfade
 * com o fim do segmento anterior (ou com a pose em que o avatar estava).
 */
export class TimelinePlayer {
  readonly timeline: Timeline;
  readonly #clips: ReadonlyMap<string, SignClip>;
  readonly #initial: Pose;
  readonly #a: Pose = new Map();
  readonly #b: Pose = new Map();

  constructor(timeline: Timeline, clips: ReadonlyMap<string, SignClip>, initial: Pose) {
    this.timeline = timeline;
    this.#clips = clips;
    this.#initial = copyPose(initial);
  }

  get duration(): number {
    return this.timeline.duration;
  }

  #sampleSegment(
    segment: Segment,
    local: number,
    out: Pose,
    contacts: ContactSample[],
    face: Map<FaceChannel, number>,
    weight: number,
  ): Pose {
    const clip = segment.clip ? this.#clips.get(segment.clip) : undefined;
    if (!clip) return copyPose(this.#initial, out);
    const time = segment.from + Math.min(local, segment.to - segment.from);
    clip.sampleContacts(time, weight, contacts);
    clip.sampleFace(time, weight, face);
    return clip.sample(time, out);
  }

  /** Pose e pistas não manuais no instante `t` (segundos da linha do tempo). */
  sample(t: number, out: Pose): PlayerFrame {
    // Ossos que o clipe não anima ficam no repouso (e o giro da cabeça não se acumula).
    for (const q of out.values()) q.identity();
    const { segments } = this.timeline;
    let index = segments.findIndex((s) => t < s.end);
    if (index < 0) index = segments.length - 1;
    const segment = segments[index];
    const contacts: ContactSample[] = [];
    const face = new Map<FaceChannel, number>();
    if (segment) {
      const into = t - segment.start;
      if (into < segment.blend) {
        const u = smoothstep(into / segment.blend);
        const prev = segments[index - 1];
        const a = prev
          ? this.#sampleSegment(prev, Number.POSITIVE_INFINITY, this.#a, contacts, face, 1 - u)
          : this.#initial;
        const b = this.#sampleSegment(segment, 0, this.#b, contacts, face, u);
        blendPoses(a, b, u, out);
      } else {
        const local = (into - segment.blend) * segment.rate;
        this.#sampleSegment(segment, local, out, contacts, face, 1);
      }
    } else {
      copyPose(this.#initial, out);
    }

    const expressions = new Map<ExpressionCueName, number>();
    for (const cue of this.timeline.expressions) {
      const w = cue.weight * envelope(t, cue.start, cue.end);
      if (w > (expressions.get(cue.name) ?? 0)) expressions.set(cue.name, w);
    }
    let headYaw = 0;
    let headPitch = 0;
    for (const cue of this.timeline.head) {
      const w = envelope(t, cue.start, cue.end);
      if (w <= 0) continue;
      // Balanço de ~2,5 Hz e 12°, como um "não" com a cabeça.
      if (cue.kind === "shake") headYaw += w * 0.21 * Math.sin(2 * Math.PI * 2.5 * (t - cue.start));
      else headPitch += w * (cue.pitch ?? 0);
    }
    let handShift = 0;
    for (const cue of this.timeline.hand) {
      handShift = Math.max(handShift, envelope(t, cue.start, cue.end));
    }
    return { segment, expressions, face, headYaw, headPitch, handShift, contacts };
  }
}

/** Soma o giro e a inclinação da cabeça à pose (parte no pescoço, parte na cabeça). */
export function applyHeadTurn(pose: Pose, yaw: number, pitch = 0): void {
  if (yaw === 0 && pitch === 0) return;
  for (const [bone, share] of [
    ["neck", 0.4],
    ["head", 0.6],
  ] as const) {
    const turn = new Quaternion().setFromAxisAngle(UP, yaw * share);
    if (pitch !== 0) turn.premultiply(new Quaternion().setFromAxisAngle(RIGHT, pitch * share));
    const q = pose.get(bone);
    if (q) q.multiply(turn);
    else pose.set(bone, turn);
  }
}

/** Giro do braço (rad) que leva a mão dominante uns 3 cm para fora numa letra repetida. */
const HAND_SHIFT = 0.12;

/**
 * Desloca a mão direita para fora (letra ou algarismo repetido, como em `ANNA` ou `11`):
 * gira o braço em torno da vertical, no referencial do ombro.
 */
export function applyHandShift(pose: Pose, amount: number): void {
  if (amount <= 0) return;
  const turn = new Quaternion().setFromAxisAngle(UP, -HAND_SHIFT * amount);
  const q = pose.get("rightUpperArm");
  if (q) q.premultiply(turn);
  else pose.set("rightUpperArm", turn);
}

/**
 * Soma uma respiração lenta à pose (tórax e ombros sobem um pouco, a cabeça compensa),
 * para o avatar não parecer congelado entre os sinais.
 */
export function applyBreathing(pose: Pose, time: number): void {
  const phase = Math.sin((2 * Math.PI * time) / BREATH_PERIOD);
  for (const [bone, axis, amplitude] of BREATH) {
    const turn = new Quaternion().setFromAxisAngle(axis, amplitude * phase);
    const q = pose.get(bone);
    if (q) q.multiply(turn);
    else pose.set(bone, turn);
  }
}
