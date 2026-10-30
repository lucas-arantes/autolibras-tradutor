import { SignQueue } from "@autolibras/core";
import {
  AnimationClip,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
} from "three";
import { describe, expect, it } from "vitest";
import type { ContactSample } from "./contacts";
import { blendPoses, smoothstep, TimelinePlayer } from "./player";
import { type Pose, SignClip, SignPack, type SignPackManifest } from "./sign-pack";
import { planGloss } from "./timeline";
import { type AvatarStage, type SignEvent, VrmRenderer } from "./vrm-renderer";

const Y = new Vector3(0, 1, 0);

// Espera todas as microtarefas pendentes. Contar ticks de `await` não é confiável:
// o número muda entre versões do V8 (o CI usa Node 22; aqui passava com outra versão).
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function yaw(deg: number): Quaternion {
  return new Quaternion().setFromAxisAngle(Y, (deg * Math.PI) / 180);
}

/** Clipe de teste: o braço gira de `a` a `b` graus ao longo de `duration`. */
function rotationClip(name: string, duration: number, a: number, b: number): AnimationClip {
  const qa = yaw(a);
  const qb = yaw(b);
  const track = new QuaternionKeyframeTrack(
    "leftUpperArm.quaternion",
    [0, duration],
    [...qa.toArray(), ...qb.toArray()],
  );
  // EU encosta a mão no peito durante o clipe todo.
  const contact =
    name === "EU"
      ? [
          new VectorKeyframeTrack("contact_right_chest_indexTip.position", [0], [0, -0.5, 0.3]),
          new VectorKeyframeTrack("contact_right_chest_indexTip.scale", [0], [1, 1, 1]),
        ]
      : [];
  // OI tem bico (oralização) e sobrancelhas franzidas gravados no clipe.
  const face =
    name === "OI"
      ? [
          new VectorKeyframeTrack(
            "face_pucker.scale",
            [0, duration],
            [0.8, 0.8, 0.8, 0.8, 0.8, 0.8],
          ),
          new VectorKeyframeTrack("face_browFrown.scale", [0], [1, 1, 1]),
        ]
      : [];
  return new AnimationClip(name, duration, [track, ...contact, ...face]);
}

function angleOf(pose: Pose, bone = "leftUpperArm"): number {
  const q = pose.get(bone) ?? new Quaternion();
  return (2 * Math.acos(Math.min(1, Math.abs(q.w))) * 180) / Math.PI;
}

const CLIPS: Record<string, [number, number, number, number, number]> = {
  // nome: duração, início e fim do trecho principal, ângulo inicial e final
  CASA: [2, 0.5, 1.5, 0, 90],
  EU: [2, 0.5, 1.5, 0, 45],
  A: [1, 0.3, 0.7, 0, 20],
  OI: [2, 0.5, 1.5, 0, 30],
};

function fakePack(): SignPack {
  const manifest: SignPackManifest = {
    format: "autolibras-sign-pack",
    version: 1,
    skeleton: "vrm-humanoid-normalized",
    license: "GPL-3.0-only",
    rest: "CASA",
    signs: Object.fromEntries(
      Object.entries(CLIPS).map(([name, [duration, strokeStart, strokeEnd]]) => [
        name,
        { file: `${name}.glb`, duration, strokeStart, strokeEnd },
      ]),
    ),
  };
  return new SignPack("https://sinais.test/pacote", {
    fetch: async (url) => {
      const href = String(url);
      if (href.endsWith("manifest.json")) return Response.json(manifest);
      return new Response(new TextEncoder().encode(href));
    },
    parse: async (data) => {
      const name = /pacote\/(\w+)\.glb$/.exec(new TextDecoder().decode(data))?.[1] ?? "";
      const spec = CLIPS[name];
      return spec ? [rotationClip(name, spec[0], spec[3], spec[4])] : [];
    },
  });
}

/** Palco falso: o teste avança o relógio na mão. */
class FakeStage implements AvatarStage {
  readonly expressionNames: string[];
  tick?: (dt: number) => void;
  frames: Array<{ pose: Pose; expressions: Map<string, number>; contacts: ContactSample[] }> = [];
  disposed = false;
  collisions = true;

  constructor(expressions: string[] = ["surprised", "browDown", "happy"]) {
    this.expressionNames = expressions;
  }

  async load(): Promise<void> {}

  render(
    pose: Pose,
    expressions: ReadonlyMap<string, number>,
    _dt: number,
    contacts: readonly ContactSample[] = [],
  ): void {
    this.frames.push({
      pose: new Map([...pose].map(([k, q]) => [k, q.clone()])),
      expressions: new Map(expressions),
      contacts: [...contacts],
    });
  }

  start(tick: (dt: number) => void): () => void {
    this.tick = tick;
    return () => {
      this.tick = undefined;
    };
  }

  setCollisions(enabled: boolean): void {
    this.collisions = enabled;
  }

  dispose(): void {
    this.disposed = true;
  }

  /** Avança `seconds` em passos de 1/60 s, deixando as promessas andarem. */
  async advance(seconds: number): Promise<void> {
    for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {
      this.tick?.(1 / 60);
      await flush();
    }
  }

  get last() {
    const frame = this.frames.at(-1);
    if (!frame) throw new Error("nenhum quadro");
    return frame;
  }
}

async function setup(expressions?: string[], faceWeight?: number) {
  const stage = new FakeStage(expressions);
  const renderer = new VrmRenderer({ signs: fakePack(), stage, faceWeight });
  await renderer.load();
  return { stage, renderer };
}

describe("TimelinePlayer", () => {
  it("faz crossfade osso a osso com slerp entre o fim de um sinal e o início do próximo", async () => {
    const pack = fakePack();
    await pack.load();
    const timeline = planGloss("CASA EU", pack);
    const clips = new Map([
      ["CASA", await pack.clip("CASA")],
      ["EU", await pack.clip("EU")],
    ]);
    const player = new TimelinePlayer(timeline, clips, new Map());
    const eu = timeline.segments[1];
    if (!eu) throw new Error("sem segundo sinal");
    const pose: Pose = new Map();
    // Fim do trecho principal de CASA: 1,5 s de 2 s → 67,5°.
    player.sample(eu.start, pose);
    expect(angleOf(pose)).toBeCloseTo(67.5, 1);
    // Meio da transição: metade do caminho até o início do trecho de EU (11,25°).
    player.sample(eu.start + eu.blend / 2, pose);
    expect(angleOf(pose)).toBeCloseTo((67.5 + 11.25) / 2, 1);
    player.sample(eu.start + eu.blend, pose);
    expect(angleOf(pose)).toBeCloseTo(11.25, 1);
    // Depois do fim, fica no último quadro de EU (volta ao repouso do clipe).
    player.sample(timeline.duration + 1, pose);
    expect(angleOf(pose)).toBeCloseTo(45, 1);
  });

  it("interpola pelo caminho mais curto e trata ossos ausentes como repouso", () => {
    const a: Pose = new Map([["head", yaw(170)]]);
    const b: Pose = new Map([
      ["head", yaw(-170)],
      ["neck", yaw(40)],
    ]);
    const out = blendPoses(a, b, 0.5, new Map());
    expect(angleOf(out, "head")).toBeCloseTo(180, 3);
    expect(angleOf(out, "neck")).toBeCloseTo(20, 3);
    expect(smoothstep(-1)).toBe(0);
    expect(smoothstep(0.5)).toBe(0.5);
    expect(smoothstep(2)).toBe(1);
  });
});

describe("SignPack", () => {
  it("carrega o manifest, baixa cada clipe uma vez só e informa os sinais", async () => {
    const requests: string[] = [];
    const pack = new SignPack("https://sinais.test/pacote/", {
      fetch: async (url) => {
        requests.push(String(url));
        if (String(url).endsWith("manifest.json")) {
          return Response.json({
            format: "autolibras-sign-pack",
            rest: "A",
            signs: { A: { file: "A.glb", duration: 1, strokeStart: 0.2, strokeEnd: 0.8 } },
          });
        }
        return new Response(new ArrayBuffer(4));
      },
      parse: async () => [rotationClip("A", 1, 0, 10)],
    });
    await pack.load();
    expect(pack.names).toEqual(["A"]);
    expect(pack.info("A")?.strokeEnd).toBe(0.8);
    const [first, second] = await Promise.all([pack.clip("A"), pack.clip("A")]);
    expect(first).toBe(second);
    expect(first).toBeInstanceOf(SignClip);
    expect(requests).toEqual([
      "https://sinais.test/pacote/manifest.json",
      "https://sinais.test/pacote/A.glb",
    ]);
    await expect(pack.clip("B")).rejects.toThrow("ausente");
  });

  it("recusa um manifest de outro formato", async () => {
    const pack = new SignPack("https://sinais.test/", {
      fetch: async () => Response.json({ signs: {} }),
    });
    await expect(pack.load()).rejects.toThrow("não é um pacote");
  });
});

describe("VrmRenderer (contrato do AvatarRenderer)", () => {
  it("carrega uma vez só e começa na pose de repouso", async () => {
    const { stage, renderer } = await setup();
    await renderer.load();
    await stage.advance(0.1);
    expect(angleOf(stage.last.pose)).toBeCloseTo(0, 3);
  });

  it("play resolve quando a sinalização termina", async () => {
    const { stage, renderer } = await setup();
    let done = false;
    const play = renderer.play("CASA EU").then(() => {
      done = true;
    });
    await flush();
    expect(renderer.playing).toBe(true);
    const duration = planGloss("CASA EU", renderer.pack).duration;
    await stage.advance(duration - 0.1);
    expect(done).toBe(false);
    await stage.advance(0.2);
    await play;
    expect(done).toBe(true);
    expect(renderer.playing).toBe(false);
  });

  it("setSpeed acelera a reprodução e é limitado", async () => {
    const { stage, renderer } = await setup();
    renderer.setSpeed(2);
    expect(renderer.speed).toBe(2);
    let done = false;
    const play = renderer.play("CASA EU").then(() => {
      done = true;
    });
    await flush();
    const duration = planGloss("CASA EU", renderer.pack).duration;
    await stage.advance(duration / 2 + 0.05);
    await play;
    expect(done).toBe(true);
    renderer.setSpeed(100);
    expect(renderer.speed).toBe(3);
    renderer.setSpeed(Number.NaN);
    expect(renderer.speed).toBe(3);
  });

  it("stop interrompe, resolve o play pendente e volta ao repouso", async () => {
    const { stage, renderer } = await setup();
    const play = renderer.play("CASA");
    await flush();
    await stage.advance(1);
    expect(angleOf(stage.last.pose)).toBeGreaterThan(20);
    renderer.stop();
    await play;
    await stage.advance(1);
    expect(angleOf(stage.last.pose)).toBeLessThan(0.5);
  });

  it("um novo play substitui o anterior", async () => {
    const { stage, renderer } = await setup();
    const signs: string[] = [];
    renderer.on("sign", (e: SignEvent) => signs.push(e.unit.label));
    const first = renderer.play("CASA");
    await flush();
    await stage.advance(0.5);
    const second = renderer.play("EU");
    await first;
    await flush();
    expect(renderer.playing).toBe(true);
    await stage.advance(3);
    await second;
    expect(signs).toEqual(["CASA", "EU"]);
  });

  it("resolve na hora uma glosa sem sinais", async () => {
    const { renderer } = await setup();
    await renderer.play("[PONTO]");
    expect(renderer.playing).toBe(false);
  });

  it("soletra palavras sem sinal e avisa os placeholders", async () => {
    const { stage, renderer } = await setup();
    const events: string[] = [];
    renderer.on("sign", (e) => events.push(`${e.unit.kind}:${e.unit.label}`));
    const play = renderer.play("AA QQ");
    await flush();
    await stage.advance(10);
    await play;
    expect(events).toEqual(["letter:A", "letter:A", "placeholder:QQ"]);
  });

  it("liga as pistas de expressão às expressões que o modelo tem", async () => {
    const { stage, renderer } = await setup(["surprised", "browDown"]);
    const play = renderer.play("CASA [INTERROGAÇÃO]");
    await flush();
    await stage.advance(1);
    // Sem `browUp` no modelo, a pergunta sim/não usa `surprised`.
    expect(stage.last.expressions.get("surprised")).toBeCloseTo(1);
    renderer.stop();
    await play;
    await stage.advance(0.1);
    expect(stage.last.expressions.size).toBe(0);
  });

  it("toca as expressões gravadas no clipe com as expressões do modelo", async () => {
    const { stage, renderer } = await setup(["mouthPucker", "browDown", "browUp"]);
    const play = renderer.play("OI");
    await flush();
    await stage.advance(0.8);
    expect(stage.last.expressions.get("mouthPucker")).toBeCloseTo(0.8 * 0.9);
    expect(stage.last.expressions.get("browDown")).toBeCloseTo(0.9);
    renderer.setFaceWeight(0);
    await stage.advance(1 / 60);
    expect(stage.last.expressions.size).toBe(0);
    renderer.stop();
    await play;
  });

  it("cai na expressão alternativa e deixa a pergunta mandar nas sobrancelhas", async () => {
    const { stage, renderer } = await setup(["ou", "browDown", "browUp"]);
    const play = renderer.play("OI [INTERROGAÇÃO]");
    await flush();
    await stage.advance(1);
    // Sem `mouthPucker`, o bico usa o visema `ou`.
    expect(stage.last.expressions.get("ou")).toBeCloseTo(0.8 * 0.7);
    // A pergunta sim/não ergue as sobrancelhas; o franzido do sinal some.
    expect(stage.last.expressions.get("browUp")).toBeCloseTo(1);
    expect(stage.last.expressions.get("browDown") ?? 0).toBeLessThan(0.01);
    renderer.stop();
    await play;
  });

  it("inclina a cabeça na pergunta", async () => {
    const { stage, renderer } = await setup();
    const play = renderer.play("CASA [INTERROGAÇÃO]");
    await flush();
    await stage.advance(1);
    expect(angleOf(stage.last.pose, "head")).toBeGreaterThan(2);
    renderer.stop();
    await play;
  });

  it("desliza a mão direita na letra repetida", async () => {
    const { stage, renderer } = await setup();
    const play = renderer.play("AA");
    await flush();
    const angles: number[] = [];
    for (let i = 0; i < 90; i++) {
      await stage.advance(1 / 60);
      angles.push(angleOf(stage.last.pose, "rightUpperArm"));
    }
    expect(Math.max(...angles)).toBeGreaterThan(5);
    expect(angles[0]).toBeLessThan(0.5);
    renderer.stop();
    await play;
  });

  it("balança a cabeça na negação", async () => {
    const { stage, renderer } = await setup();
    const play = renderer.play("NÃO_CASA");
    await flush();
    const yaws: number[] = [];
    for (let i = 0; i < 60; i++) {
      await stage.advance(1 / 60);
      yaws.push(angleOf(stage.last.pose, "head"));
    }
    expect(Math.max(...yaws)).toBeGreaterThan(3);
    expect(stage.last.expressions.get("browDown")).toBeGreaterThan(0);
    renderer.stop();
    await play;
  });

  it("repassa ao palco os contatos do clipe, com o peso do crossfade", async () => {
    const { stage, renderer } = await setup();
    const play = renderer.play("CASA EU");
    await flush();
    const eu = planGloss("CASA EU", renderer.pack).segments[1];
    await stage.advance((eu?.start ?? 0) + (eu?.blend ?? 0) / 2);
    const [blending] = stage.last.contacts;
    expect(blending?.weight).toBeGreaterThan(0.2);
    expect(blending?.weight).toBeLessThan(0.8);
    await stage.advance(0.3);
    expect(stage.last.contacts).toEqual([
      expect.objectContaining({ side: "right", anchor: "chest", point: "indexTip", weight: 1 }),
    ]);
    renderer.setContacts(false);
    await stage.advance(0.1);
    expect(stage.last.contacts).toEqual([]);
    renderer.stop();
    await play;
  });

  it("liga e desliga a correção de colisões do palco", async () => {
    const { stage, renderer } = await setup();
    renderer.setCollisions(false);
    expect(stage.collisions).toBe(false);
    renderer.setCollisions(true);
    expect(stage.collisions).toBe(true);
  });

  it("funciona com a SignQueue do core", async () => {
    const { stage, renderer } = await setup();
    const queue = new SignQueue(renderer, {}, () => 0);
    const ended: string[] = [];
    queue.on("end", (item) => ended.push(item.gloss));
    queue.enqueue({ id: "1", text: "casa", gloss: "CASA" });
    queue.enqueue({ id: "2", text: "eu", gloss: "EU" });
    await flush();
    await stage.advance(6);
    expect(ended).toEqual(["CASA", "EU"]);
  });

  it("dispose para o laço e libera o palco", async () => {
    const { stage, renderer } = await setup();
    renderer.dispose();
    expect(stage.tick).toBeUndefined();
    expect(stage.disposed).toBe(true);
  });
});
