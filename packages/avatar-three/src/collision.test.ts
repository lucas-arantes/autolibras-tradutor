import { Object3D, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  armPoints,
  type BodySample,
  type BodyVolume,
  fitBodyVolumes,
  measurePenetration,
  resolveCollisions,
  type SlicedVolume,
  slicedField,
  softPush,
  VolumeFrames,
} from "./collision";
import { type BoneLookup, type ContactSample, type HandSide, solveArm } from "./contacts";

type Spec = [name: string, parent: string | null, x: number, y: number, z: number];

/** Esqueleto humanoide mínimo em pose T (rotações identidade), em metros. */
function rig() {
  const specs: Spec[] = [
    ["hips", null, 0, 1, 0],
    ["spine", "hips", 0, 0.05, 0],
    ["chest", "spine", 0, 0.15, 0],
    ["upperChest", "chest", 0, 0.15, 0],
    ["neck", "upperChest", 0, 0.15, 0],
    ["head", "neck", 0, 0.1, 0],
  ];
  for (const [side, sx] of [
    ["left", 1],
    ["right", -1],
  ] as const) {
    specs.push(
      [`${side}Shoulder`, "upperChest", 0.05 * sx, 0.1, 0],
      [`${side}UpperArm`, `${side}Shoulder`, 0.12 * sx, 0, 0],
      [`${side}LowerArm`, `${side}UpperArm`, 0.28 * sx, 0, 0],
      [`${side}Hand`, `${side}LowerArm`, 0.25 * sx, 0, 0],
    );
    for (const [finger, z] of [
      ["Index", 0.02],
      ["Middle", 0],
    ] as const) {
      specs.push(
        [`${side}${finger}Proximal`, `${side}Hand`, 0.09 * sx, 0, z],
        [`${side}${finger}Intermediate`, `${side}${finger}Proximal`, 0.04 * sx, 0, 0],
        [`${side}${finger}Distal`, `${side}${finger}Intermediate`, 0.025 * sx, 0, 0],
      );
    }
    specs.push(
      [`${side}ThumbMetacarpal`, `${side}Hand`, 0.02 * sx, 0, 0.02],
      [`${side}ThumbProximal`, `${side}ThumbMetacarpal`, 0.03 * sx, 0, 0.03],
      [`${side}ThumbDistal`, `${side}ThumbProximal`, 0.02 * sx, 0, 0.02],
    );
  }
  const nodes = new Map<string, Object3D>();
  const root = new Object3D();
  for (const [name, parent, x, y, z] of specs) {
    const node = new Object3D();
    node.name = name;
    node.position.set(x, y, z);
    (parent ? nodes.get(parent) : root)?.add(node);
    nodes.set(name, node);
  }
  root.updateMatrixWorld(true);
  const bone: BoneLookup = (name) => nodes.get(name);
  return { root, bone };
}

/** Tronco elíptico (mais largo que fundo), cabeça redonda e antebraços que afinam. */
const TORSO = { rx: 0.16, rz: 0.11, cz: 0.02, bottom: 0.95, top: 1.5 };

function bodySamples(bone: BoneLookup): BodySample[] {
  const samples: BodySample[] = [];
  for (let y = TORSO.bottom; y <= TORSO.top + 1e-9; y += 0.01) {
    const name = y < 1.2 ? "spine" : y < 1.35 ? "chest" : "upperChest";
    for (let a = 0; a < 360; a += 5) {
      const t = (a * Math.PI) / 180;
      const position = new Vector3(TORSO.rx * Math.cos(t), y, TORSO.cz + TORSO.rz * Math.sin(t));
      samples.push({ position, bone: name });
    }
  }
  const head = new Vector3(0, 1.7, 0.02);
  for (let a = 0; a < 180; a += 10) {
    for (let b = 0; b < 360; b += 10) {
      const [t, p] = [(a * Math.PI) / 180, (b * Math.PI) / 180];
      const offset = new Vector3(Math.sin(t) * Math.cos(p), Math.cos(t), Math.sin(t) * Math.sin(p));
      samples.push({ position: head.clone().addScaledVector(offset, 0.09), bone: "head" });
    }
  }
  for (const side of ["left", "right"] as const) {
    const a = bone(`${side}LowerArm`)?.getWorldPosition(new Vector3()) ?? new Vector3();
    const b = bone(`${side}Hand`)?.getWorldPosition(new Vector3()) ?? new Vector3();
    for (let t = 0; t <= 1 + 1e-9; t += 0.05) {
      const center = a.clone().lerp(b, t);
      const radius = 0.05 - 0.02 * t;
      for (let p = 0; p < 360; p += 30) {
        const q = (p * Math.PI) / 180;
        const offset = new Vector3(0, Math.cos(q), Math.sin(q)).multiplyScalar(radius);
        samples.push({ position: center.clone().add(offset), bone: `${side}LowerArm` });
      }
    }
  }
  return samples;
}

function setup() {
  const { root, bone } = rig();
  const volumes = fitBodyVolumes(bodySamples(bone), bone);
  return { root, bone, volumes };
}

function world(bone: BoneLookup, name: string): Vector3 {
  return bone(name)?.getWorldPosition(new Vector3()) ?? new Vector3(Number.NaN);
}

function handDepth(bone: BoneLookup, root: Object3D, volumes: BodyVolume[], side: HandSide) {
  return (
    measurePenetration(bone, root, volumes).find((p) => p.side === side && p.part === "hand")
      ?.depth ?? 0
  );
}

/** Menor folga entre a mão e o corpo (negativa se entrou). */
function handGap(bone: BoneLookup, volumes: BodyVolume[], side: HandSide): number {
  const frames = new VolumeFrames(bone);
  let gap = Number.POSITIVE_INFINITY;
  for (const point of armPoints(bone, side)) {
    if (point.part !== "hand") continue;
    for (const volume of volumes) {
      if (volume.kind !== "sliced") continue;
      const probe = frames.probe(volume, point.position);
      if (probe) gap = Math.min(gap, probe.distance - point.radius);
    }
  }
  return gap;
}

describe("fitBodyVolumes", () => {
  it("ajusta o tronco em fatias à malha, mais largo que fundo", () => {
    const { bone, volumes } = setup();
    const names = volumes.map((v) => v.name);
    expect(names).toEqual(
      expect.arrayContaining(["spine", "chest", "upperChest", "head", "leftLowerArm"]),
    );
    const chest = volumes.find((v) => v.name === "chest") as SlicedVolume;
    const local = (x: number, y: number, z: number) =>
      new Vector3(x, y, z).sub(world(bone, "chest"));
    // No centro, o campo é menos o raio; nos lados e na frente, a superfície da malha.
    expect(slicedField(chest, local(0, 1.28, TORSO.cz))).toBeLessThan(-0.1);
    expect(slicedField(chest, local(TORSO.rx, 1.28, TORSO.cz))).toBeCloseTo(0, 2);
    expect(slicedField(chest, local(0, 1.28, TORSO.cz + TORSO.rz))).toBeCloseTo(0, 2);
    expect(slicedField(chest, local(0, 1.28, TORSO.cz + TORSO.rz + 0.05))).toBeCloseTo(0.05, 2);
  });

  it("afina a cápsula do antebraço do cotovelo ao punho", () => {
    const { volumes } = setup();
    const forearm = volumes.find((v) => v.name === "leftLowerArm");
    expect(forearm?.kind).toBe("capsule");
    if (forearm?.kind !== "capsule") return;
    expect(forearm.radius[0]).toBeCloseTo(0.047, 2);
    expect(forearm.radius[1]).toBeCloseTo(0.033, 2);
  });
});

describe("softPush", () => {
  it("é contínua e sem quina nas pontas da rampa", () => {
    const soft = 0.006;
    expect(softPush(-0.02, soft)).toBe(0);
    expect(softPush(0.02, soft)).toBe(0.02);
    for (const x of [-soft, soft]) {
      expect(softPush(x - 1e-7, soft)).toBeCloseTo(softPush(x + 1e-7, soft), 6);
      const slope = (dx: number) => (softPush(x + dx, soft) - softPush(x, soft)) / dx;
      expect(slope(1e-6)).toBeCloseTo(slope(-1e-6), 2);
    }
  });
});

describe("resolveCollisions", () => {
  it("tira a mão de dentro do peito pela frente e a deixa encostada", () => {
    const { root, bone, volumes } = setup();
    const target = new Vector3(-0.03, 1.28, 0.05);
    solveArm(bone, "right", target);
    root.updateMatrixWorld(true);
    expect(handDepth(bone, root, volumes, "right")).toBeGreaterThan(0.05);
    const handBefore = bone("rightHand")?.getWorldQuaternion(new Quaternion()) ?? new Quaternion();

    const report = resolveCollisions(bone, root, volumes);
    expect(report.depth.right).toBeGreaterThan(0.05);
    expect(handDepth(bone, root, volumes, "right")).toBeLessThan(0.002);
    // Encostada na superfície, não parada no ar.
    expect(handGap(bone, volumes, "right")).toBeLessThan(0.01);
    const wrist = world(bone, "rightHand");
    expect(wrist.z).toBeGreaterThan(target.z + 0.05);
    expect(Math.abs(wrist.x - target.x)).toBeLessThan(0.03);
    expect(Math.abs(wrist.y - target.y)).toBeLessThan(0.03);
    expect(
      bone("rightHand")?.getWorldQuaternion(new Quaternion()).angleTo(handBefore),
    ).toBeLessThan(1e-4);
  });

  it("não mexe numa mão longe do corpo", () => {
    const { root, bone, volumes } = setup();
    const target = new Vector3(-0.2, 1.3, 0.35);
    solveArm(bone, "right", target);
    const report = resolveCollisions(bone, root, volumes);
    expect(report.shift.right).toBe(0);
    expect(world(bone, "rightHand").distanceTo(target)).toBeLessThan(1e-4);
  });

  it("move a mão sem saltos quando ela atravessa a superfície", () => {
    const { root, bone, volumes } = setup();
    let previous: Vector3 | null = null;
    let largest = 0;
    for (let z = 0.0; z <= 0.3; z += 0.002) {
      solveArm(bone, "right", new Vector3(-0.03, 1.28, z));
      resolveCollisions(bone, root, volumes);
      const wrist = world(bone, "rightHand");
      if (previous) largest = Math.max(largest, wrist.distanceTo(previous));
      previous = wrist;
    }
    // Passos de 2 mm no alvo: a mão corrigida nunca anda muito mais que isso.
    expect(largest).toBeLessThan(0.006);
  });

  it("com as mãos se tocando, as duas saem juntas do corpo", () => {
    const { root, bone, volumes } = setup();
    solveArm(bone, "left", new Vector3(0.03, 1.28, 0.06));
    solveArm(bone, "right", new Vector3(-0.03, 1.28, 0.06));
    root.updateMatrixWorld(true);
    const apart = world(bone, "leftHand").sub(world(bone, "rightHand"));
    const touch = (side: HandSide): ContactSample => ({
      side,
      anchor: "hand",
      point: "middleTip",
      other: "middleTip",
      offset: new Vector3(),
      weight: 1,
    });
    resolveCollisions(bone, root, volumes, [touch("left"), touch("right")]);
    expect(handDepth(bone, root, volumes, "left")).toBeLessThan(0.003);
    expect(handDepth(bone, root, volumes, "right")).toBeLessThan(0.003);
    const after = world(bone, "leftHand").sub(world(bone, "rightHand"));
    expect(after.distanceTo(apart)).toBeLessThan(0.005);
  });

  it("afasta a mão do antebraço do outro lado", () => {
    const { root, bone, volumes } = setup();
    // Antebraço esquerdo à frente do peito; a mão direita em cima dele.
    solveArm(bone, "left", new Vector3(-0.05, 1.2, 0.35));
    root.updateMatrixWorld(true);
    const elbow = world(bone, "leftLowerArm");
    const wrist = world(bone, "leftHand");
    solveArm(
      bone,
      "right",
      elbow
        .clone()
        .lerp(wrist, 0.6)
        .add(new Vector3(0, 0.01, 0)),
    );
    root.updateMatrixWorld(true);
    const before = measurePenetration(bone, root, volumes).find((p) => p.side === "right");
    expect(before?.volume).toBe("leftLowerArm");
    expect(before?.depth).toBeGreaterThan(0.02);
    resolveCollisions(bone, root, volumes);
    expect(handDepth(bone, root, volumes, "right")).toBeLessThan(0.003);
  });

  it("gira o cotovelo para tirar o antebraço do tronco, sem mover a mão", () => {
    const { root, bone, volumes } = setup();
    // Mão na frente do peito e o cotovelo girado para dentro do tronco.
    const target = new Vector3(0.02, 1.2, 0.2);
    solveArm(bone, "right", target);
    root.updateMatrixWorld(true);
    const axis = target.clone().sub(world(bone, "rightUpperArm")).normalize();
    bone("rightUpperArm")?.quaternion.premultiply(new Quaternion().setFromAxisAngle(axis, 0.4));
    root.updateMatrixWorld(true);
    const forearm = () =>
      measurePenetration(bone, root, volumes).find(
        (p) => p.side === "right" && p.part === "forearm",
      )?.depth ?? 0;
    const before = forearm();
    expect(before).toBeGreaterThan(0.01);
    const report = resolveCollisions(bone, root, volumes);
    expect(report.swivel.right).toBeGreaterThan(0.1);
    expect(report.swivel.right).toBeLessThanOrEqual(0.3 + 1e-9);
    expect(forearm()).toBeLessThan(0.003);
    expect(world(bone, "rightHand").distanceTo(target)).toBeLessThan(1e-3);
  });

  it("não faz nada sem volumes", () => {
    const { root, bone } = rig();
    solveArm(bone, "right", new Vector3(0, 1.28, 0.05));
    const report = resolveCollisions(bone, root, []);
    expect(report.shift).toEqual({ left: 0, right: 0 });
  });
});
