import { type Matrix4, type Object3D, Quaternion, Vector3 } from "three";
import {
  type BoneLookup,
  type ContactSample,
  type HandSide,
  rotateWorld,
  solveArm,
} from "./contacts";

/**
 * Parte do corpo em fatias horizontais, presa a um osso: cada fatia tem um centro e o
 * raio da superfície em `bins` direções. Serve para tronco, pescoço e cabeça, que não são
 * cilindros (o peito é mais largo que fundo, o nariz sai do rosto).
 */
export interface SlicedVolume {
  kind: "sliced";
  name: string;
  bone: string;
  /** `y` local da primeira fatia e a distância entre fatias, em metros. */
  y0: number;
  step: number;
  bins: number;
  /** Centro `(x, z)` de cada fatia, no referencial do osso. */
  centers: number[];
  /** Raio de cada fatia em cada direção (`fatia * bins + direção`). */
  radii: number[];
}

/** Segmento entre um osso e o seguinte (braço ou antebraço), mais grosso numa ponta. */
export interface CapsuleVolume {
  kind: "capsule";
  name: string;
  bone: string;
  tail: string;
  /** Raio no começo e no fim do segmento (a manga afina do cotovelo ao punho). */
  radius: [number, number];
  side: HandSide;
}

export type BodyVolume = SlicedVolume | CapsuleVolume;

/** Vértice da malha em repouso, em coordenadas de mundo, e o osso humanoide que o move. */
export interface BodySample {
  position: Vector3;
  bone: string;
}

export interface FitOptions {
  /** Distância entre fatias (m). */
  step: number;
  /** Direções por fatia. */
  bins: number;
  /** Quanto cada volume avança sobre o vizinho, para não deixar fresta na junta (m). */
  overlap: number;
}

export const DEFAULT_FIT_OPTIONS: FitOptions = { step: 0.02, bins: 24, overlap: 0.04 };

const TORSO_BONES = ["hips", "spine", "chest", "upperChest", "leftShoulder", "rightShoulder"];

/** Volume do tronco (o antebraço só é testado contra ele). */
function isTorso(volume: BodyVolume): boolean {
  return volume.kind === "sliced" && TORSO_BONES.includes(volume.bone);
}

/** Ossos de cada grupo e os volumes do grupo: osso e o osso onde o volume acaba. */
const SLICED_GROUPS: Array<{ bones: string[]; volumes: Array<[string, string | null]> }> = [
  {
    bones: TORSO_BONES,
    volumes: [
      ["spine", "chest"],
      ["chest", "upperChest"],
      ["upperChest", null],
    ],
  },
  { bones: ["neck"], volumes: [["neck", null]] },
  { bones: ["head", "jaw", "leftEye", "rightEye"], volumes: [["head", null]] },
];

const CAPSULES: Array<[string, string]> = [
  ["UpperArm", "LowerArm"],
  ["LowerArm", "Hand"],
];
/** Fração dos vértices do braço que fica dentro da cápsula, em cada ponta. */
const CAPSULE_QUANTILE = 0.75;
/** Trecho de cada ponta usado para medir o raio dela (fração do comprimento). */
const CAPSULE_END = 0.3;

/**
 * Ajusta volumes simples à malha do avatar em repouso: tronco (três pedaços, um por osso
 * da coluna), pescoço e cabeça em fatias, e uma cápsula para cada braço e antebraço.
 * Cada fatia pega o vértice mais afastado do centro em cada direção, então o volume
 * acompanha a roupa, e não o corpo por baixo dela.
 */
export function fitBodyVolumes(
  samples: Iterable<BodySample>,
  bone: BoneLookup,
  options: Partial<FitOptions> = {},
): BodyVolume[] {
  const opts = { ...DEFAULT_FIT_OPTIONS, ...options };
  const byBone = new Map<string, Vector3[]>();
  for (const { position, bone: name } of samples) {
    const list = byBone.get(name);
    if (list) list.push(position);
    else byBone.set(name, [position]);
  }
  const volumes: BodyVolume[] = [];
  for (const group of SLICED_GROUPS) {
    const points = group.bones.flatMap((name) => byBone.get(name) ?? []);
    if (points.length === 0) continue;
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    for (const p of points) {
      low = Math.min(low, p.y);
      high = Math.max(high, p.y);
    }
    group.volumes.forEach(([name, next], i) => {
      const node = bone(name);
      if (!node) return;
      const end = next ? bone(next) : null;
      const from = i === 0 ? low : worldY(node) - opts.overlap;
      const to = end ? worldY(end) + opts.overlap : high;
      const volume = fitSliced(`${name}`, name, node, points, from, to, opts);
      if (volume) volumes.push(volume);
    });
  }
  for (const side of ["left", "right"] as const) {
    for (const [from, to] of CAPSULES) {
      const head = bone(`${side}${from}`);
      const tail = bone(`${side}${to}`);
      const points = byBone.get(`${side}${from}`);
      if (!head || !tail || !points?.length) continue;
      const a = head.getWorldPosition(new Vector3());
      const b = tail.getWorldPosition(new Vector3());
      const measured = points.map((p) => ({
        t: segmentParam(p, a, b),
        d: distanceToSegment(p, a, b),
      }));
      const end = (near: (t: number) => boolean) => {
        const d = measured.filter(({ t }) => near(t)).map(({ d }) => d);
        return d.length
          ? quantile(d, CAPSULE_QUANTILE)
          : quantile(
              measured.map(({ d }) => d),
              CAPSULE_QUANTILE,
            );
      };
      const radius: [number, number] = [
        end((t) => t <= CAPSULE_END),
        end((t) => t >= 1 - CAPSULE_END),
      ];
      volumes.push({
        kind: "capsule",
        name: `${side}${from}`,
        bone: `${side}${from}`,
        tail: `${side}${to}`,
        radius,
        side,
      });
    }
  }
  return volumes;
}

function worldY(node: Object3D): number {
  return node.getWorldPosition(new Vector3()).y;
}

function fitSliced(
  name: string,
  boneName: string,
  node: Object3D,
  world: readonly Vector3[],
  from: number,
  to: number,
  { step, bins }: FitOptions,
): SlicedVolume | null {
  const inverse = node.matrixWorld.clone().invert();
  const y0 = from - worldY(node);
  const y1 = to - worldY(node);
  const count = Math.max(2, Math.ceil((y1 - y0) / step) + 1);
  const local = world.map((p) => p.clone().applyMatrix4(inverse));
  const centers: number[] = [];
  const radii: number[] = [];
  let filled = 0;
  for (let k = 0; k < count; k++) {
    const y = y0 + k * step;
    // Cada fatia junta os vértices até uma fatia acima e abaixo: fica um pouco maior que
    // a malha, nunca menor.
    const slice = local.filter((p) => Math.abs(p.y - y) <= step);
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (const p of slice) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const cx = slice.length ? (minX + maxX) / 2 : 0;
    const cz = slice.length ? (minZ + maxZ) / 2 : 0;
    const ring = new Array<number>(bins).fill(-1);
    for (const p of slice) {
      const dx = p.x - cx;
      const dz = p.z - cz;
      const r = Math.hypot(dx, dz);
      const a = wrap((Math.atan2(dz, dx) / (2 * Math.PI)) * bins, bins);
      // O vértice conta para as duas direções vizinhas.
      for (const j of [Math.floor(a) % bins, Math.ceil(a) % bins]) {
        ring[j] = Math.max(ring[j] ?? -1, r);
      }
    }
    fillRing(ring);
    if (slice.length) filled++;
    centers.push(cx, cz);
    radii.push(...ring);
  }
  if (filled === 0) return null;
  return { kind: "sliced", name, bone: boneName, y0, step, bins, centers, radii };
}

/** Preenche direções sem vértices interpolando as vizinhas (ou zera a fatia vazia). */
function fillRing(ring: number[]): void {
  const n = ring.length;
  const known = ring.flatMap((r, j) => (r >= 0 ? [j] : []));
  if (known.length === 0) {
    ring.fill(0);
    return;
  }
  for (let j = 0; j < n; j++) {
    if ((ring[j] ?? -1) >= 0) continue;
    let before = j;
    while ((ring[before] ?? -1) < 0) before = (before - 1 + n) % n;
    let after = j;
    while ((ring[after] ?? -1) < 0) after = (after + 1) % n;
    const span = (after - before + n) % n || n;
    const t = ((j - before + n) % n) / span;
    ring[j] = (ring[before] ?? 0) * (1 - t) + (ring[after] ?? 0) * t;
  }
}

function wrap(a: number, n: number): number {
  return ((a % n) + n) % n;
}

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.floor(q * (sorted.length - 1))] ?? 0;
}

function segmentParam(p: Vector3, a: Vector3, b: Vector3): number {
  const ab = b.clone().sub(a);
  return Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-12)));
}

function distanceToSegment(p: Vector3, a: Vector3, b: Vector3): number {
  return p.distanceTo(closestOnSegment(p, a, b));
}

function closestOnSegment(p: Vector3, a: Vector3, b: Vector3): Vector3 {
  return a.clone().lerp(b, segmentParam(p, a, b));
}

/**
 * Campo do volume em fatias, no referencial do osso: negativo dentro, positivo fora,
 * mais ou menos em metros. As pontas de cima e de baixo são planas.
 */
export function slicedField(volume: SlicedVolume, p: Vector3): number {
  const { y0, step, bins, centers, radii } = volume;
  const count = centers.length / 2;
  const y1 = y0 + (count - 1) * step;
  const u = Math.min(count - 1, Math.max(0, (p.y - y0) / step));
  const i = Math.min(count - 2, Math.floor(u));
  const t = u - i;
  const cx = lerp(centers[2 * i] ?? 0, centers[2 * i + 2] ?? 0, t);
  const cz = lerp(centers[2 * i + 1] ?? 0, centers[2 * i + 3] ?? 0, t);
  const dx = p.x - cx;
  const dz = p.z - cz;
  const a = wrap((Math.atan2(dz, dx) / (2 * Math.PI)) * bins, bins);
  const j = Math.floor(a) % bins;
  const k = (j + 1) % bins;
  const s = a - Math.floor(a);
  const ring = (row: number) => lerp(radii[row * bins + j] ?? 0, radii[row * bins + k] ?? 0, s);
  const radius = lerp(ring(i), ring(i + 1), t);
  const side = Math.hypot(dx, dz) - radius;
  const cap = Math.max(y0 - p.y, p.y - y1);
  return Math.max(side, cap);
}

/** Distância (com sinal) de um ponto à superfície de um volume e a normal para fora. */
export interface SurfaceProbe {
  distance: number;
  normal: Vector3;
}

/** Por onde tirar uma esfera de dentro de um volume: direção e quanto andar nela. */
export interface Exit {
  /** Quanto a esfera precisa andar (negativo: está fora, com essa folga). */
  gap: number;
  direction: Vector3;
}

const GRADIENT_STEP = 0.004;
const AXES = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];
const FORWARD = new Vector3(0, 0, 1);
/** Direções de saída, da frente do corpo (0) até a normal da superfície (1). */
const EXIT_MIX = [0, 1 / 3, 2 / 3, 1];
/** Custo extra de sair pelos lados em vez de pela frente, onde fica o espaço de sinalização. */
const SIDE_COST = 0.8;
const MARCH_STEP = 0.01;
const MARCH_LIMIT = 0.35;

/** Distância aproximada à superfície do volume em fatias, no referencial do osso. */
function slicedDistance(volume: SlicedVolume, p: Vector3, gradient = new Vector3()): number {
  const f = slicedField(volume, p);
  const q = new Vector3();
  AXES.forEach((axis, i) => {
    const plus = slicedField(volume, q.copy(p).addScaledVector(axis, GRADIENT_STEP));
    const minus = slicedField(volume, q.copy(p).addScaledVector(axis, -GRADIENT_STEP));
    gradient.setComponent(i, (plus - minus) / (2 * GRADIENT_STEP));
  });
  return f / Math.max(gradient.length(), 0.5);
}

/** Quanto andar de `p` na direção `d` até a esfera de raio `radius` sair do volume. */
function march(volume: SlicedVolume, p: Vector3, d: Vector3, radius: number): number {
  const q = new Vector3();
  const outside = (t: number) => slicedDistance(volume, q.copy(p).addScaledVector(d, t)) >= radius;
  let low = 0;
  let high = MARCH_STEP;
  while (!outside(high)) {
    low = high;
    high += MARCH_STEP;
    if (high > MARCH_LIMIT) return Number.POSITIVE_INFINITY;
  }
  for (let i = 0; i < 6; i++) {
    const mid = (low + high) / 2;
    if (outside(mid)) high = mid;
    else low = mid;
  }
  return high;
}

/** Matrizes dos ossos dos volumes na pose atual (uma vez por quadro). */
export class VolumeFrames {
  readonly #bone: BoneLookup;
  readonly #frames = new Map<string, { inverse: Matrix4; rotation: Quaternion } | null>();

  constructor(bone: BoneLookup) {
    this.#bone = bone;
  }

  #frame(name: string): { inverse: Matrix4; rotation: Quaternion } | null {
    let frame = this.#frames.get(name);
    if (frame === undefined) {
      const node = this.#bone(name);
      frame = node
        ? {
            inverse: node.matrixWorld.clone().invert(),
            rotation: node.getWorldQuaternion(new Quaternion()),
          }
        : null;
      this.#frames.set(name, frame);
    }
    return frame;
  }

  /** Distância com sinal e normal da superfície mais próxima (para medir). */
  probe(volume: BodyVolume, world: Vector3): SurfaceProbe | null {
    if (volume.kind === "capsule") return this.#probeCapsule(volume, world);
    const frame = this.#frame(volume.bone);
    if (!frame) return null;
    const gradient = new Vector3();
    const distance = slicedDistance(volume, world.clone().applyMatrix4(frame.inverse), gradient);
    if (gradient.lengthSq() < 1e-12) return null;
    return { distance, normal: gradient.normalize().applyQuaternion(frame.rotation) };
  }

  /**
   * Como tirar uma esfera do volume. Perto da superfície, sai pela normal. Mais para
   * dentro, a normal de um volume em fatias aponta para longe do centro, e uma mão no
   * meio do peito sairia pelo lado; por isso testa também direções puxadas para a frente
   * do osso e fica com a que exige menos caminho, com a frente levando vantagem.
   */
  exit(volume: BodyVolume, world: Vector3, radius: number, soft: number): Exit | null {
    if (volume.kind === "capsule") {
      const probe = this.#probeCapsule(volume, world);
      return probe && { gap: radius - probe.distance, direction: probe.normal };
    }
    const frame = this.#frame(volume.bone);
    if (!frame) return null;
    const p = world.clone().applyMatrix4(frame.inverse);
    const normal = new Vector3();
    const distance = slicedDistance(volume, p, normal);
    if (distance >= radius + soft || normal.lengthSq() < 1e-12) return null;
    normal.normalize();
    if (distance >= radius) {
      return { gap: radius - distance, direction: normal.applyQuaternion(frame.rotation) };
    }
    let best: Exit | null = null;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const mix of EXIT_MIX) {
      const d = FORWARD.clone().lerp(normal, mix);
      if (d.lengthSq() < 1e-6) continue;
      d.normalize();
      const travel = march(volume, p, d, radius);
      const cost = travel * (1 + SIDE_COST * mix);
      if (cost < bestCost) {
        bestCost = cost;
        best = { gap: travel, direction: d };
      }
    }
    if (!best) return null;
    best.direction.applyQuaternion(frame.rotation);
    return best;
  }

  #probeCapsule(volume: CapsuleVolume, world: Vector3): SurfaceProbe | null {
    const a = this.#bone(volume.bone)?.getWorldPosition(new Vector3());
    const b = this.#bone(volume.tail)?.getWorldPosition(new Vector3());
    if (!a || !b) return null;
    const t = segmentParam(world, a, b);
    const away = world.clone().sub(a.clone().lerp(b, t));
    const length = away.length();
    if (length < 1e-6) return null;
    const radius = lerp(volume.radius[0], volume.radius[1], t);
    return { distance: length - radius, normal: away.divideScalar(length) };
  }
}

export type ArmPart = "hand" | "forearm";

/** Ponto do braço testado contra o corpo, com o raio da mão ou do antebraço ali. */
export interface ArmPoint {
  part: ArmPart;
  position: Vector3;
  radius: number;
}

/** Raios aproximados da mão e da manga do modelo do AutoLibras, em metros. */
const HAND_RADII = {
  wrist: 0.02,
  palm: 0.018,
  proximal: 0.01,
  middle: 0.009,
  distal: 0.008,
  tip: 0.007,
};
const FOREARM_RADII = [0.035, 0.03];
const FINGERS = ["Thumb", "Index", "Middle", "Ring", "Little"];
const TIP_RATIO = 0.8;

function worldOf(bone: BoneLookup, name: string): Vector3 | null {
  return bone(name)?.getWorldPosition(new Vector3()) ?? null;
}

/**
 * Pontos da mão (punho, palma e as juntas e pontas dos dedos) e do antebraço que não
 * podem entrar no corpo. Os da mão andam junto com o punho quando o IK move o braço.
 */
export function armPoints(bone: BoneLookup, side: HandSide): ArmPoint[] {
  const points: ArmPoint[] = [];
  const wrist = worldOf(bone, `${side}Hand`);
  const elbow = worldOf(bone, `${side}LowerArm`);
  if (!wrist) return points;
  const add = (part: ArmPart, position: Vector3 | null, radius: number) => {
    if (position) points.push({ part, position, radius });
  };
  add("hand", wrist, HAND_RADII.wrist);
  const middle = worldOf(bone, `${side}MiddleProximal`);
  if (middle) add("hand", wrist.clone().add(middle).multiplyScalar(0.5), HAND_RADII.palm);
  for (const finger of FINGERS) {
    const joints =
      finger === "Thumb"
        ? ["Metacarpal", "Proximal", "Distal"]
        : ["Proximal", "Intermediate", "Distal"];
    const [p0, p1, p2] = joints.map((j) => worldOf(bone, `${side}${finger}${j}`));
    if (finger !== "Thumb") add("hand", p0 ?? null, HAND_RADII.proximal);
    add("hand", p1 ?? null, HAND_RADII.middle);
    add("hand", p2 ?? null, HAND_RADII.distal);
    if (p1 && p2)
      add("hand", p2.clone().add(p2.clone().sub(p1).multiplyScalar(TIP_RATIO)), HAND_RADII.tip);
  }
  if (elbow) {
    FOREARM_RADII.forEach((radius, i) => {
      const t = (i + 1) / (FOREARM_RADII.length + 1);
      add("forearm", elbow.clone().lerp(wrist, t), radius);
    });
  }
  return points;
}

/** Quanto um ponto entrou num volume: maior que zero é penetração (m). */
export interface Penetration {
  side: HandSide;
  part: ArmPart;
  volume: string;
  depth: number;
}

/** Volumes que valem para a mão de um lado: o corpo e o braço do outro lado. */
function collides(volume: BodyVolume, side: HandSide): boolean {
  return volume.kind === "sliced" || volume.side !== side;
}

/** Maior penetração de cada lado e parte do braço na pose atual (para medir). */
export function measurePenetration(
  bone: BoneLookup,
  root: Object3D,
  volumes: readonly BodyVolume[],
): Penetration[] {
  root.updateMatrixWorld(true);
  const frames = new VolumeFrames(bone);
  const result: Penetration[] = [];
  for (const side of SIDES) {
    const worst = new Map<ArmPart, Penetration>();
    for (const point of armPoints(bone, side)) {
      for (const volume of volumes) {
        if (!collides(volume, side)) continue;
        // O antebraço só conta contra o tronco: perto do queixo, com a mão na boca, ele
        // está no lugar certo.
        if (point.part === "forearm" && !isTorso(volume)) continue;
        const probe = frames.probe(volume, point.position);
        if (!probe) continue;
        const depth = point.radius - probe.distance;
        if (depth > (worst.get(point.part)?.depth ?? 0)) {
          worst.set(point.part, { side, part: point.part, volume: volume.name, depth });
        }
      }
    }
    result.push(...worst.values());
  }
  return result;
}

export interface CollisionOptions {
  /**
   * Largura da rampa suave em volta da superfície (m): o empurrão começa um pouco antes
   * do contato e cresce sem tranco, para a mão não pular de um quadro para o outro.
   */
  soft: number;
  /** Deslocamento máximo do punho por quadro (m). */
  maxShift: number;
  /** Rodadas de correção (cada uma mede de novo depois do IK). */
  rounds: number;
}

export const DEFAULT_COLLISION_OPTIONS: CollisionOptions = {
  soft: 0.006,
  maxShift: 0.2,
  rounds: 3,
};

export interface CollisionReport {
  /** Quanto a mão precisava andar para sair do corpo, antes da correção, por lado (m). */
  depth: Record<HandSide, number>;
  /** Quanto o punho andou, por lado (m). */
  shift: Record<HandSide, number>;
  /** Quanto o cotovelo girou para tirar o antebraço do corpo (rad). */
  swivel: Record<HandSide, number>;
}

const SIDES: HandSide[] = ["left", "right"];

/**
 * Quanto empurrar para a distância à superfície ficar em `gap`: zero longe da
 * superfície, `gap` cheio dentro dela e uma rampa quadrática (sem quina) entre os dois.
 */
export function softPush(gap: number, soft: number): number {
  if (gap >= soft) return gap;
  if (gap <= -soft) return 0;
  return ((gap + soft) * (gap + soft)) / (4 * soft);
}

interface Constraint {
  normal: Vector3;
  need: number;
  /** Braço do outro lado com que a mão colide (`undefined` para o corpo). */
  arm?: HandSide;
}

/** Menor deslocamento que satisfaz `deslocamento · normal >= need` para todas as restrições. */
function project(constraints: readonly Constraint[]): Vector3 {
  const shift = new Vector3();
  for (let sweep = 0; sweep < 6; sweep++) {
    let moved = false;
    for (const { normal, need } of constraints) {
      const missing = need - shift.dot(normal);
      if (missing > 1e-6) {
        shift.addScaledVector(normal, missing);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return shift;
}

/** Peso do contato entre as mãos: com ele, as duas saem do corpo juntas. */
function mutualWeight(contacts: readonly ContactSample[]): number {
  let weight = 0;
  for (const c of contacts) if (c.anchor === "hand") weight = Math.max(weight, c.weight);
  return Math.min(1, weight);
}

/**
 * Tira as mãos e os antebraços de dentro do corpo, depois dos contatos. Para a mão, mede
 * cada ponto contra os volumes e calcula o menor deslocamento do punho que deixa todos
 * do lado de fora (ou encostados, com o raio da mão), e resolve o braço com o mesmo IK dos
 * contatos, sem mudar a orientação da mão. Uma mão que devia tocar o peito termina na
 * superfície. Com as mãos se tocando, as duas andam juntas. Se depois disso o antebraço
 * ainda entra no tronco, o cotovelo gira em volta da linha ombro–punho, o que não tira a
 * mão do lugar.
 */
export function resolveCollisions(
  bone: BoneLookup,
  root: Object3D,
  volumes: readonly BodyVolume[],
  contacts: readonly ContactSample[] = [],
  options: Partial<CollisionOptions> = {},
): CollisionReport {
  const { soft, maxShift, rounds } = { ...DEFAULT_COLLISION_OPTIONS, ...options };
  const report: CollisionReport = {
    depth: { left: 0, right: 0 },
    shift: { left: 0, right: 0 },
    swivel: { left: 0, right: 0 },
  };
  if (volumes.length === 0) return report;
  const mutual = mutualWeight(contacts);
  root.updateMatrixWorld(true);

  for (let round = 0; round < rounds; round++) {
    const frames = new VolumeFrames(bone);
    const constraints = new Map<HandSide, Constraint[]>();
    for (const side of SIDES) {
      const list: Constraint[] = [];
      for (const point of armPoints(bone, side)) {
        if (point.part !== "hand") continue;
        for (const volume of volumes) {
          if (!collides(volume, side)) continue;
          const exit = frames.exit(volume, point.position, point.radius, soft);
          if (!exit) continue;
          if (round === 0) report.depth[side] = Math.max(report.depth[side], exit.gap);
          const need = softPush(exit.gap, soft);
          if (need > 1e-5) {
            list.push({
              normal: exit.direction,
              need,
              arm: volume.kind === "capsule" ? volume.side : undefined,
            });
          }
        }
      }
      constraints.set(side, list);
    }
    const left = constraints.get("left") ?? [];
    const right = constraints.get("right") ?? [];
    if (left.length === 0 && right.length === 0) break;
    // Com as mãos se tocando, as duas saem juntas do corpo, e a mão que entra no braço
    // do outro lado só se afasta dele dividindo o caminho com esse braço: andar juntas não
    // mudaria nada entre elas.
    const joint = mutual > 0 ? project([...left, ...right].filter((c) => !c.arm)) : null;
    const apart = new Map<HandSide, Constraint[]>(SIDES.map((side) => [side, []]));
    for (const c of [...left, ...right]) {
      if (!c.arm) continue;
      const half = c.need / 2;
      const other = c.arm === "left" ? "right" : "left";
      apart.get(other)?.push({ normal: c.normal, need: half });
      apart.get(c.arm)?.push({ normal: c.normal.clone().negate(), need: half });
    }
    for (const side of SIDES) {
      const shift = project(side === "left" ? left : right);
      if (joint) shift.lerp(joint.clone().add(project(apart.get(side) ?? [])), mutual);
      if (shift.lengthSq() < 1e-10) continue;
      if (shift.length() > maxShift) shift.setLength(maxShift);
      const wrist = worldOf(bone, `${side}Hand`);
      if (!wrist) continue;
      solveArm(bone, side, wrist.add(shift));
      report.shift[side] += shift.length();
    }
    root.updateMatrixWorld(true);
  }

  for (const side of SIDES) report.swivel[side] = swivelElbow(bone, side, volumes, soft);
  root.updateMatrixWorld(true);
  return report;
}

/**
 * Giro máximo do cotovelo (rad). Mais que isso, o cotovelo sobe até a altura do ombro e
 * a pose fica estranha; a manga encostada no peito, da mesma cor da camisa, quase não
 * aparece.
 */
const MAX_SWIVEL = 0.3;

/** Gira o braço em volta da linha ombro–punho até o antebraço sair do tronco. */
function swivelElbow(
  bone: BoneLookup,
  side: HandSide,
  volumes: readonly BodyVolume[],
  soft: number,
): number {
  const upper = bone(`${side}UpperArm`);
  const hand = bone(`${side}Hand`);
  if (!upper || !hand) return 0;
  const body = volumes.filter(isTorso);
  let total = 0;
  for (let step = 0; step < 3; step++) {
    const frames = new VolumeFrames(bone);
    let worst: { need: number; normal: Vector3; position: Vector3 } | null = null;
    for (const point of armPoints(bone, side)) {
      if (point.part !== "forearm") continue;
      for (const volume of body) {
        const probe = frames.probe(volume, point.position);
        if (!probe) continue;
        const need = softPush(point.radius - probe.distance, soft);
        if (need > 1e-5 && need > (worst?.need ?? 0)) {
          worst = { need, normal: probe.normal, position: point.position };
        }
      }
    }
    if (!worst) break;
    const shoulder = upper.getWorldPosition(new Vector3());
    const axis = hand.getWorldPosition(new Vector3()).sub(shoulder).normalize();
    // Direção em que o ponto anda quando o braço gira em volta do eixo.
    const tangent = axis.clone().cross(worst.position.clone().sub(shoulder));
    const radius = tangent.length();
    if (radius < 0.02) break;
    const along = worst.normal.dot(tangent.divideScalar(radius));
    // Se o giro quase não afasta o ponto do corpo, não adianta girar.
    if (Math.abs(along) < 0.25) break;
    const angle = Math.max(
      -MAX_SWIVEL - total,
      Math.min(MAX_SWIVEL - total, worst.need / (radius * along)),
    );
    if (Math.abs(angle) < 1e-4) break;
    const handWorld = hand.getWorldQuaternion(new Quaternion());
    rotateWorld(upper, new Quaternion().setFromAxisAngle(axis, angle));
    const parent = hand.parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion();
    hand.quaternion.copy(parent.invert().multiply(handWorld));
    hand.updateMatrixWorld(true);
    total += angle;
  }
  return Math.abs(total);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
