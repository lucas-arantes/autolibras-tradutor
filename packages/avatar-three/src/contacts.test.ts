import { AnimationClip, Object3D, Quaternion, Vector3, VectorKeyframeTrack } from "three";
import { describe, expect, it } from "vitest";
import { applyContacts, type ContactSample, handPoint, solveArm } from "./contacts";
import { SignClip } from "./sign-pack";

type Spec = [name: string, parent: string | null, x: number, y: number, z: number];

/** Esqueleto humanoide mínimo em pose T (rotações identidade), em metros. */
function rig() {
  const specs: Spec[] = [
    ["hips", null, 0, 1, 0],
    ["spine", "hips", 0, 0.1, 0],
    ["upperChest", "spine", 0, 0.3, 0],
    ["neck", "upperChest", 0, 0.15, 0],
    ["head", "neck", 0, 0.08, 0],
    ["leftEye", "head", 0.032, 0.08, 0.08],
    ["rightEye", "head", -0.032, 0.08, 0.08],
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
  return { root, bone: (name: string) => nodes.get(name) };
}

function world(node: Object3D | undefined): Vector3 {
  return node?.getWorldPosition(new Vector3()) ?? new Vector3(Number.NaN);
}

describe("solveArm", () => {
  it("leva o punho ao alvo, inclusive com o braço esticado, e mantém a orientação da mão", () => {
    const { root, bone } = rig();
    const hand = bone("leftHand");
    hand?.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), 0.6);
    root.updateMatrixWorld(true);
    const before = hand?.getWorldQuaternion(new Quaternion()) ?? new Quaternion();
    const target = new Vector3(0.25, 1.35, 0.3);
    expect(solveArm(bone, "left", target)).toBe(true);
    root.updateMatrixWorld(true);
    expect(world(hand).distanceTo(target)).toBeLessThan(1e-4);
    expect(hand?.getWorldQuaternion(new Quaternion()).angleTo(before)).toBeLessThan(1e-4);
    // O cotovelo dobra para a frente, não para trás.
    expect(world(bone("leftLowerArm")).z).toBeGreaterThan(-0.01);
  });

  it("estica até o limite quando o alvo está fora de alcance", () => {
    const { root, bone } = rig();
    solveArm(bone, "right", new Vector3(-2, 1.5, 0.5));
    root.updateMatrixWorld(true);
    const shoulder = world(bone("rightUpperArm"));
    expect(world(bone("rightHand")).distanceTo(shoulder)).toBeCloseTo(0.53, 3);
  });
});

describe("handPoint", () => {
  it("estende a falange distal para estimar a ponta do dedo", () => {
    const { bone } = rig();
    const distal = world(bone("leftMiddleDistal"));
    const tip = handPoint(bone, "left", "middleTip");
    expect(tip?.x).toBeCloseTo(distal.x + 0.025 * 0.8, 5);
    const palm = handPoint(bone, "left", "palm");
    expect(palm?.x).toBeCloseTo(
      (world(bone("leftHand")).x + world(bone("leftMiddleProximal")).x) / 2,
    );
  });
});

describe("applyContacts", () => {
  const forehead = (weight: number): ContactSample => ({
    side: "left",
    anchor: "face",
    point: "middleTip",
    // Acima e à frente do meio dos olhos, na escala da distância entre eles.
    offset: new Vector3(0, 0.8, 1.2),
    weight,
  });

  it("leva o ponto da mão até o alvo no rosto", () => {
    const { root, bone } = rig();
    const report = applyContacts(bone, root, [forehead(1)], { maxShift: 1 });
    const [residual] = report.residuals;
    expect(residual?.before).toBeGreaterThan(5);
    expect(residual?.after).toBeLessThan(0.01);
    const eyes = world(bone("leftEye"))
      .add(world(bone("rightEye")))
      .multiplyScalar(0.5);
    const tip = handPoint(bone, "left", "middleTip");
    expect(tip?.distanceTo(eyes.add(new Vector3(0, 0.8, 1.2).multiplyScalar(0.064)))).toBeLessThan(
      1e-3,
    );
  });

  it("aplica só parte da correção com peso parcial e limita o deslocamento", () => {
    const full = rig();
    const fullShift = applyContacts(full.bone, full.root, [forehead(1)], { maxShift: 1 }).shift
      .left;
    const half = rig();
    const halfShift = applyContacts(half.bone, half.root, [forehead(0.5)], { maxShift: 1 }).shift
      .left;
    expect(halfShift).toBeCloseTo(fullShift / 2, 4);
    const limited = rig();
    expect(applyContacts(limited.bone, limited.root, [forehead(1)]).shift.left).toBeCloseTo(0.25);
  });

  it("aproxima as duas mãos, cada uma andando metade do caminho", () => {
    const { root, bone } = rig();
    const touch = (side: "left" | "right"): ContactSample => ({
      side,
      anchor: "hand",
      point: "middleTip",
      other: "middleTip",
      offset: new Vector3(),
      weight: 1,
    });
    const report = applyContacts(bone, root, [touch("left"), touch("right")], { maxShift: 2 });
    expect(report.shift.left).toBeCloseTo(report.shift.right, 5);
    const left = handPoint(bone, "left", "middleTip");
    const right = handPoint(bone, "right", "middleTip");
    expect(left && right ? left.distanceTo(right) : 1).toBeLessThan(1e-3);
  });

  it("não faz nada sem contatos", () => {
    const { root, bone } = rig();
    expect(applyContacts(bone, root, []).residuals).toEqual([]);
  });
});

describe("SignClip com contatos", () => {
  it("lê as trilhas dos nós de contato e devolve deslocamento e peso", () => {
    const node = "contact_left_hand_middleTip_thumbTip";
    const clip = new AnimationClip("CASA", 1, [
      new VectorKeyframeTrack(`${node}.position`, [0, 1], [0, 0, 0, 2, 4, 6]),
      new VectorKeyframeTrack(`${node}.scale`, [0, 1], [0, 0, 0, 1, 1, 1]),
    ]);
    const sign = new SignClip("CASA", clip);
    expect(sign.hasContacts).toBe(true);
    expect(sign.sampleContacts(0, 1, [])).toEqual([]);
    const [contact] = sign.sampleContacts(0.5, 0.5, []);
    expect(contact).toMatchObject({
      side: "left",
      anchor: "hand",
      point: "middleTip",
      other: "thumbTip",
      weight: 0.25,
    });
    expect(contact?.offset.toArray()).toEqual([1, 2, 3]);
  });
});
