import { type AnimationClip, type Interpolant, Quaternion, QuaternionKeyframeTrack } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { SignCatalog, SignInfo } from "./timeline";

/** Pose: rotação local de cada osso humanoide normalizado do VRM. */
export type Pose = Map<string, Quaternion>;

/** Clipe de um sinal, amostrável em qualquer instante. */
export class SignClip {
  readonly name: string;
  readonly duration: number;
  readonly #tracks: Array<{ bone: string; interpolant: Interpolant }> = [];

  constructor(name: string, clip: AnimationClip) {
    this.name = name;
    this.duration = clip.duration;
    for (const track of clip.tracks) {
      const dot = track.name.lastIndexOf(".");
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

  get bones(): string[] {
    return this.#tracks.map((t) => t.bone);
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
