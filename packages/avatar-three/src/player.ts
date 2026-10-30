import { Quaternion, Vector3 } from "three";
import type { ContactSample } from "./contacts";
import type { Pose, SignClip } from "./sign-pack";
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
  /** Giro da cabeça (rad) para os lados, do movimento de negação. */
  headYaw: number;
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
    weight: number,
  ): Pose {
    const clip = segment.clip ? this.#clips.get(segment.clip) : undefined;
    if (!clip) return copyPose(this.#initial, out);
    const time = segment.from + Math.min(local, segment.to - segment.from);
    clip.sampleContacts(time, weight, contacts);
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
    if (segment) {
      const into = t - segment.start;
      if (into < segment.blend) {
        const u = smoothstep(into / segment.blend);
        const prev = segments[index - 1];
        const a = prev
          ? this.#sampleSegment(prev, Number.POSITIVE_INFINITY, this.#a, contacts, 1 - u)
          : this.#initial;
        const b = this.#sampleSegment(segment, 0, this.#b, contacts, u);
        blendPoses(a, b, u, out);
      } else {
        this.#sampleSegment(segment, (into - segment.blend) * segment.rate, out, contacts, 1);
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
    for (const cue of this.timeline.head) {
      const w = envelope(t, cue.start, cue.end);
      // Balanço de ~2,5 Hz e 12°, como um "não" com a cabeça.
      if (w > 0) headYaw += w * 0.21 * Math.sin(2 * Math.PI * 2.5 * (t - cue.start));
    }
    return { segment, expressions, headYaw, contacts };
  }
}

/** Soma o giro da cabeça à pose (parte no pescoço, parte na cabeça). */
export function applyHeadYaw(pose: Pose, yaw: number): void {
  if (yaw === 0) return;
  for (const [bone, share] of [
    ["neck", 0.4],
    ["head", 0.6],
  ] as const) {
    const turn = new Quaternion().setFromAxisAngle(UP, yaw * share);
    const q = pose.get(bone);
    if (q) q.multiply(turn);
    else pose.set(bone, turn);
  }
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
