// Medição das mãos dentro do corpo (demo/collision-check.mjs). Toca cada sinal com um
// relógio manual, sem desenhar, e mede quadro a quadro quanto a mão e o antebraço entram
// nos volumes do corpo. `capture` desenha um instante de um sinal para a captura de tela.
import {
  type AvatarStage,
  armPoints,
  type ContactSample,
  DEFAULT_AVATAR_URL,
  measurePenetration,
  poseSkeleton,
  ThreeVrmStage,
  VolumeFrames,
  VrmRenderer,
} from "../src/index";

const FPS = 30;
const THRESHOLDS = [0.005, 0.01, 0.02];
/** Contato com o rosto ou o peito com peso a partir daqui conta como "encostar". */
const TOUCH_WEIGHT = 0.9;

const params = new URLSearchParams(location.search);
const signsUrl = params.get("signs") ?? "https://lucas-arantes.github.io/autolibras-sinais/BR/";
const canvas = document.querySelector<HTMLCanvasElement>("#avatar");
if (!canvas) throw new Error("falta o canvas");

const inner = new ThreeVrmStage({
  canvas,
  avatarUrl: DEFAULT_AVATAR_URL,
  background: "#eef2f6",
  autoBlink: false,
});

interface Frame {
  t: number;
  hand: number;
  forearm: number;
  side: string;
  volume: string;
  gaps: number[];
}

let tickFn: ((dt: number) => void) | undefined;
let draw = false;
let collisions = true;
let recording: Frame[] | null = null;
let clock = 0;

function bone(name: string) {
  return inner.vrm?.humanoid.getNormalizedBoneNode(name as never);
}

/** Distância das mãos que deviam encostar no rosto ou no peito até a superfície (m). */
function touchGaps(contacts: readonly ContactSample[]): number[] {
  const vrm = inner.vrm;
  if (!vrm) return [];
  const frames = new VolumeFrames(bone);
  const body = inner.volumes.filter((v) => v.kind === "sliced");
  const gaps: number[] = [];
  for (const side of ["left", "right"] as const) {
    const touching = contacts.filter(
      (c) => c.side === side && c.anchor !== "hand" && c.weight >= TOUCH_WEIGHT,
    );
    if (touching.length === 0) continue;
    let gap = Number.POSITIVE_INFINITY;
    for (const point of armPoints(bone, side)) {
      if (point.part !== "hand") continue;
      for (const volume of body) {
        const probe = frames.probe(volume, point.position);
        if (probe) gap = Math.min(gap, probe.distance - point.radius);
      }
    }
    if (Number.isFinite(gap)) gaps.push(gap);
  }
  return gaps;
}

const stage: AvatarStage = {
  load: () => inner.load(),
  get expressionNames() {
    return inner.expressionNames;
  },
  render(pose, expressions, dt, contacts = []) {
    clock += dt;
    const vrm = inner.vrm;
    if (!vrm) return;
    if (draw) inner.render(pose, expressions, dt, contacts);
    else poseSkeleton(bone, vrm.scene, pose, contacts, collisions ? inner.volumes : []);
    if (!recording) return;
    const frame: Frame = { t: clock, hand: 0, forearm: 0, side: "", volume: "", gaps: [] };
    for (const p of measurePenetration(bone, vrm.scene, inner.volumes)) {
      if (p.depth > frame[p.part]) {
        frame[p.part] = p.depth;
        if (p.part === "hand" || !frame.side) {
          frame.side = p.side;
          frame.volume = p.volume;
        }
      }
    }
    frame.gaps = touchGaps(contacts);
    recording.push(frame);
  },
  start(tick) {
    tickFn = tick;
    return () => {
      tickFn = undefined;
    };
  },
  setCollisions(enabled) {
    collisions = enabled;
    inner.setCollisions(enabled);
  },
  dispose: () => inner.dispose(),
};

const avatar = new VrmRenderer({ signs: signsUrl, stage });
const ready = avatar.load();

function tick(dt: number): void {
  tickFn?.(dt);
}

/** Volta ao repouso e começa a tocar `name`; resolve quando o sinal começou. */
async function begin(name: string): Promise<boolean> {
  for (let i = 0; i < FPS; i++) tick(1 / FPS);
  clock = 0;
  const started = new Promise<boolean>((resolve) => {
    const off = avatar.on("plan", () => {
      off();
      resolve(true);
    });
    avatar.play(name).then(() => resolve(false));
  });
  const ok = await started;
  await Promise.resolve();
  return ok && avatar.playing;
}

function summarize(frames: Frame[]) {
  const over = (part: "hand" | "forearm", min: number) =>
    frames.filter((f) => f[part] > min).length / FPS;
  const worst = frames.reduce<Frame | undefined>(
    (w, f) => (f.hand > (w?.hand ?? -1) ? f : w),
    undefined,
  );
  const deep = frames.filter((f) => f.hand > 0.01);
  const gaps = frames.flatMap((f) => f.gaps);
  return {
    seconds: frames.length / FPS,
    hand: {
      max: worst?.hand ?? 0,
      mean: deep.length ? deep.reduce((s, f) => s + f.hand, 0) / deep.length : 0,
      over: THRESHOLDS.map((min) => over("hand", min)),
      at: worst?.t ?? 0,
      side: worst?.side ?? "",
      volume: worst?.volume ?? "",
    },
    forearm: {
      max: Math.max(0, ...frames.map((f) => f.forearm)),
      at: frames.reduce(
        (w, f) => (f.forearm > w.forearm ? f : w),
        frames[0] ?? { t: 0, forearm: 0 },
      ).t,
      over: THRESHOLDS.map((min) => over("forearm", min)),
    },
    touch: { frames: gaps.length, gaps },
  };
}

/** Toca cada sinal e devolve as medidas, com ou sem a correção de colisões. */
async function measure(names: string[], withCollisions: boolean) {
  await ready;
  stage.setCollisions?.(withCollisions);
  const result: Record<string, ReturnType<typeof summarize> | { error: string }> = {};
  for (const name of names) {
    try {
      if (!(await begin(name))) {
        result[name] = { error: "não tocou" };
        continue;
      }
      recording = [];
      while (avatar.playing) tick(1 / FPS);
      result[name] = summarize(recording);
    } catch (error) {
      result[name] = { error: String(error) };
    } finally {
      recording = null;
    }
  }
  return result;
}

/** Desenha o sinal `name` no instante `at` (segundos desde o início). */
async function capture(name: string, at: number, withCollisions: boolean): Promise<boolean> {
  await ready;
  stage.setCollisions?.(withCollisions);
  draw = false;
  if (!(await begin(name))) return false;
  let drawn = false;
  while (avatar.playing && clock < at - 1e-6) {
    draw = drawn = clock + 1 / FPS >= at - 1e-6;
    tick(1 / FPS);
  }
  if (!drawn) {
    draw = true;
    tick(0);
  }
  draw = false;
  avatar.stop();
  return true;
}

Object.assign(window, { measure, capture, ready, stage: inner, avatar, tick, bone });
