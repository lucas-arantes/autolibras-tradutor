import {
  type AnimationClip,
  type Interpolant,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { ContactAnchor, ContactSample, HandPoint, HandSide } from "./contacts";
import type { SignCatalog, SignInfo } from "./timeline";

/** Pose: rotação local de cada osso humanoide normalizado do VRM. */
export type Pose = Map<string, Quaternion>;

/** Nó fictício de contato gravado pelo conversor: `contact_<lado>_<âncora>_<ponto>[_<outro>]`. */
const CONTACT_NODE =
  /^contact_(left|right)_(face|chest|hand)_(wrist|palm|indexTip|middleTip|thumbTip)(?:_(wrist|palm|indexTip|middleTip|thumbTip))?$/;

/**
 * Canais de expressão não manual gravados pelo conversor (nós `face_<canal>`, peso de 0
 * a 1 na escala). Vêm das shape keys do rosto do VLibras; ver FACE_CHANNELS no conversor.
 */
export const FACE_CHANNELS = [
  "browRaise",
  "browOuterUp",
  "browLower",
  "browFrown",
  "browAngry",
  "smile",
  "frown",
  "pucker",
  "lipPress",
  "upperLip",
  "cheekPuff",
  "cheekSuck",
  "jawOpen",
] as const;

export type FaceChannel = (typeof FACE_CHANNELS)[number];

const FACE_NODE = new RegExp(`^face_(${FACE_CHANNELS.join("|")})$`);

interface ContactChannel {
  side: HandSide;
  anchor: ContactAnchor;
  point: HandPoint;
  other: HandPoint | undefined;
  offset?: Interpolant;
  weight?: Interpolant;
}

/** Clipe de um sinal, amostrável em qualquer instante. */
export class SignClip {
  readonly name: string;
  readonly duration: number;
  readonly #tracks: Array<{ bone: string; interpolant: Interpolant }> = [];
  readonly #contacts = new Map<string, ContactChannel>();
  readonly #face: Array<{ channel: FaceChannel; interpolant: Interpolant }> = [];

  constructor(name: string, clip: AnimationClip) {
    this.name = name;
    this.duration = clip.duration;
    for (const track of clip.tracks) {
      const dot = track.name.lastIndexOf(".");
      const contact = CONTACT_NODE.exec(track.name.slice(0, dot));
      if (contact && track instanceof VectorKeyframeTrack) {
        this.#addContactTrack(track, contact, track.name.slice(dot + 1));
        continue;
      }
      const face = FACE_NODE.exec(track.name.slice(0, dot));
      if (face?.[1] && track instanceof VectorKeyframeTrack) {
        if (track.name.slice(dot + 1) === "scale") {
          const interpolant = track.InterpolantFactoryMethodLinear();
          this.#face.push({ channel: face[1] as FaceChannel, interpolant });
        }
        continue;
      }
      if (
        track.name.slice(dot + 1) !== "quaternion" ||
        !(track instanceof QuaternionKeyframeTrack)
      ) {
        continue;
      }
      // Na trilha de quaternion, o interpolante "linear" do three.js faz slerp.
      const interpolant = track.InterpolantFactoryMethodLinear();
      this.#tracks.push({ bone: track.name.slice(0, dot), interpolant });
    }
  }

  #addContactTrack(track: VectorKeyframeTrack, match: RegExpExecArray, property: string): void {
    const [node, side, anchor, point, other] = match;
    if (!node) return;
    let channel = this.#contacts.get(node);
    if (!channel) {
      channel = {
        side: side as HandSide,
        anchor: anchor as ContactAnchor,
        point: point as HandPoint,
        other: other as HandPoint | undefined,
      };
      this.#contacts.set(node, channel);
    }
    const interpolant = track.InterpolantFactoryMethodLinear();
    if (property === "position") channel.offset = interpolant;
    else if (property === "scale") channel.weight = interpolant;
  }

  get bones(): string[] {
    return this.#tracks.map((t) => t.bone);
  }

  get hasContacts(): boolean {
    return this.#contacts.size > 0;
  }

  /** Canais de expressão que o clipe anima. */
  get faceChannels(): FaceChannel[] {
    return this.#face.map((f) => f.channel);
  }

  /**
   * Soma em `out` os canais de expressão no instante `time`, multiplicados por `weight`
   * (no crossfade, cada sinal entra com o seu peso).
   */
  sampleFace(
    time: number,
    weight: number,
    out: Map<FaceChannel, number>,
  ): Map<FaceChannel, number> {
    if (weight <= 0) return out;
    const t = Math.min(Math.max(time, 0), this.duration);
    for (const { channel, interpolant } of this.#face) {
      const w = (interpolant.evaluate(t)[0] ?? 0) * weight;
      if (w > 1e-3) out.set(channel, Math.min(1, (out.get(channel) ?? 0) + w));
    }
    return out;
  }

  /** Acrescenta a `out` os contatos ativos no instante `time`, com o peso multiplicado. */
  sampleContacts(time: number, weight: number, out: ContactSample[]): ContactSample[] {
    if (weight <= 0) return out;
    const t = Math.min(Math.max(time, 0), this.duration);
    for (const channel of this.#contacts.values()) {
      if (!channel.offset || !channel.weight) continue;
      const w = (channel.weight.evaluate(t)[0] ?? 0) * weight;
      if (w <= 1e-3) continue;
      const o = channel.offset.evaluate(t);
      out.push({
        side: channel.side,
        anchor: channel.anchor,
        point: channel.point,
        other: channel.other,
        offset: new Vector3(o[0], o[1], o[2]),
        weight: w,
      });
    }
    return out;
  }

  /** Escreve em `out` a pose do clipe no instante `time` (limitado à duração). */
  sample(time: number, out: Pose): Pose {
    const t = Math.min(Math.max(time, 0), this.duration);
    for (const { bone, interpolant } of this.#tracks) {
      const v = interpolant.evaluate(t);
      let q = out.get(bone);
      if (!q) {
        q = new Quaternion();
        out.set(bone, q);
      }
      q.set(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 1).normalize();
    }
    return out;
  }
}

export interface SignPackManifest {
  format: "autolibras-sign-pack";
  version: number;
  skeleton: string;
  license: string;
  source?: string;
  rest: string | null;
  signs: Record<string, SignInfo & { file: string }>;
}

/** Converte o binário de um clipe glTF em `AnimationClip`s (injetável nos testes). */
export type ClipParser = (data: ArrayBuffer, name: string) => Promise<AnimationClip[]>;

export interface SignPackOptions {
  fetch?: typeof fetch;
  parse?: ClipParser;
}

async function parseWithGltfLoader(data: ArrayBuffer): Promise<AnimationClip[]> {
  const gltf = await new GLTFLoader().parseAsync(data, "");
  return gltf.animations;
}

/**
 * Pacote de sinais publicado à parte (os clipes convertidos do VLibras são GPL-3.0):
 * um `manifest.json` e um `.glb` por sinal, baixados por URL só quando usados.
 */
export class SignPack implements SignCatalog {
  readonly baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #parse: ClipParser;
  #manifest?: SignPackManifest;
  readonly #clips = new Map<string, Promise<SignClip>>();

  constructor(baseUrl: string, options: SignPackOptions = {}) {
    this.baseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#parse = options.parse ?? parseWithGltfLoader;
  }

  get manifest(): SignPackManifest {
    if (!this.#manifest) throw new Error("Pacote de sinais não carregado");
    return this.#manifest;
  }

  get loaded(): boolean {
    return this.#manifest !== undefined;
  }

  get rest(): string | null {
    return this.#manifest?.rest ?? null;
  }

  get names(): string[] {
    return Object.keys(this.#manifest?.signs ?? {});
  }

  async load(): Promise<void> {
    if (this.#manifest) return;
    const response = await this.#fetch(`${this.baseUrl}manifest.json`);
    if (!response.ok) throw new Error(`Pacote de sinais indisponível (${response.status})`);
    const manifest = (await response.json()) as SignPackManifest;
    if (manifest.format !== "autolibras-sign-pack") {
      throw new Error("manifest.json não é um pacote de sinais do AutoLibras");
    }
    this.#manifest = manifest;
  }

  info(name: string): SignInfo | undefined {
    return this.#manifest?.signs[name];
  }

  /** Baixa e decodifica o clipe (uma vez só por sinal). */
  clip(name: string): Promise<SignClip> {
    let pending = this.#clips.get(name);
    if (!pending) {
      pending = this.#loadClip(name);
      pending.catch(() => this.#clips.delete(name));
      this.#clips.set(name, pending);
    }
    return pending;
  }

  async #loadClip(name: string): Promise<SignClip> {
    const entry = this.manifest.signs[name];
    if (!entry) throw new Error(`Sinal ausente do pacote: ${name}`);
    // Os nomes de arquivo do pacote já são seguros para URL (ver `slug` no conversor).
    const response = await this.#fetch(`${this.baseUrl}${entry.file}`);
    if (!response.ok) throw new Error(`Falha ao baixar o sinal ${name} (${response.status})`);
    const [clip] = await this.#parse(await response.arrayBuffer(), name);
    if (!clip) throw new Error(`O arquivo do sinal ${name} não tem animação`);
    return new SignClip(name, clip);
  }
}
