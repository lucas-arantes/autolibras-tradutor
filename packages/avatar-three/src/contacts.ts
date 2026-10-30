import { type Object3D, Quaternion, Vector3 } from "three";

export type HandSide = "left" | "right";
/** Referenciais dos contatos: rosto (olhos), peito (base do pescoço) e a outra mão. */
export type ContactAnchor = "face" | "chest" | "hand";
export type HandPoint = "wrist" | "palm" | "indexTip" | "middleTip" | "thumbTip";

/**
 * Onde o ponto `point` da mão deve ficar: `offset` está no referencial da âncora e na
 * escala dela (distância entre os olhos, largura dos ombros ou comprimento da mão).
 */
export interface ContactSample {
  side: HandSide;
  anchor: ContactAnchor;
  point: HandPoint;
  /** Ponto da outra mão, quando a âncora é `hand`. */
  other?: HandPoint;
  offset: Vector3;
  weight: number;
}

/** Busca um osso humanoide normalizado do VRM (rotação de repouso identidade). */
export type BoneLookup = (name: string) => Object3D | null | undefined;

export interface ContactOptions {
  /** Deslocamento máximo do punho, em metros (protege contra dados estranhos). */
  maxShift: number;
}

export const DEFAULT_CONTACT_OPTIONS: ContactOptions = { maxShift: 0.25 };

export interface ContactReport {
  /** Deslocamento pedido para cada punho, em metros. */
  shift: Record<HandSide, number>;
  /** Distância que sobrou entre cada ponto e o alvo, na escala da âncora. */
  residuals: Array<{ contact: ContactSample; before: number; after: number }>;
}

/** Comprimento da falange distal em relação à anterior (o VRM não tem osso na ponta). */
const TIP_RATIO = 0.8;
const SIDES: HandSide[] = ["left", "right"];

function pos(bone: BoneLookup, name: string): Vector3 | null {
  const node = bone(name);
  return node ? node.getWorldPosition(new Vector3()) : null;
}

function tip(bone: BoneLookup, side: HandSide, finger: string, prev: string): Vector3 | null {
  const distal = pos(bone, `${side}${finger}Distal`);
  const before = pos(bone, `${side}${finger}${prev}`);
  if (!distal || !before) return null;
  return distal.clone().add(distal.clone().sub(before).multiplyScalar(TIP_RATIO));
}

/** Posição atual de um ponto da mão do avatar (mesma definição do conversor). */
export function handPoint(bone: BoneLookup, side: HandSide, point: HandPoint): Vector3 | null {
  switch (point) {
    case "wrist":
      return pos(bone, `${side}Hand`);
    case "palm": {
      const wrist = pos(bone, `${side}Hand`);
      const base = pos(bone, `${side}MiddleProximal`);
      return wrist && base ? wrist.add(base).multiplyScalar(0.5) : null;
    }
    case "indexTip":
      return tip(bone, side, "Index", "Intermediate");
    case "middleTip":
      return tip(bone, side, "Middle", "Intermediate");
    case "thumbTip":
      return tip(bone, side, "Thumb", "Proximal");
  }
}

interface AnchorFrame {
  origin: Vector3;
  rotation: Quaternion;
  scale: number;
}

function anchorFrame(bone: BoneLookup, contact: ContactSample): AnchorFrame | null {
  const chestNode = bone("upperChest") ?? bone("chest");
  if (contact.anchor === "face") {
    const left = pos(bone, "leftEye");
    const right = pos(bone, "rightEye");
    const head = bone("head");
    if (!left || !right || !head) return null;
    return {
      origin: left.clone().add(right).multiplyScalar(0.5),
      rotation: head.getWorldQuaternion(new Quaternion()),
      scale: left.distanceTo(right),
    };
  }
  if (!chestNode) return null;
  const rotation = chestNode.getWorldQuaternion(new Quaternion());
  if (contact.anchor === "chest") {
    const neck = pos(bone, "neck");
    const left = pos(bone, "leftUpperArm");
    const right = pos(bone, "rightUpperArm");
    if (!neck || !left || !right) return null;
    return { origin: neck, rotation, scale: left.distanceTo(right) };
  }
  const other: HandSide = contact.side === "left" ? "right" : "left";
  const origin = handPoint(bone, other, contact.other ?? contact.point);
  const wrist = pos(bone, `${contact.side}Hand`);
  const middle = handPoint(bone, contact.side, "middleTip");
  if (!origin || !wrist || !middle) return null;
  return { origin, rotation, scale: wrist.distanceTo(middle) };
}

function targetOf(frame: AnchorFrame, contact: ContactSample): Vector3 {
  return contact.offset
    .clone()
    .multiplyScalar(frame.scale)
    .applyQuaternion(frame.rotation)
    .add(frame.origin);
}

/** Aplica a rotação `rotation` (em coordenadas de mundo) ao nó, mantendo o pai. */
function rotateWorld(node: Object3D, rotation: Quaternion): void {
  const parent = node.parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion();
  node.quaternion
    .premultiply(parent)
    .premultiply(rotation)
    .premultiply(parent.invert())
    .normalize();
  node.updateMatrixWorld(true);
}

/**
 * IK analítico de dois ossos (braço e antebraço) que leva o punho a `target`. O cotovelo
 * fica no plano em que já estava e a mão mantém a orientação de mundo da pose original.
 */
export function solveArm(bone: BoneLookup, side: HandSide, target: Vector3): boolean {
  const upper = bone(`${side}UpperArm`);
  const lower = bone(`${side}LowerArm`);
  const hand = bone(`${side}Hand`);
  if (!upper || !lower || !hand) return false;
  const a = upper.getWorldPosition(new Vector3());
  const b = lower.getWorldPosition(new Vector3());
  const c = hand.getWorldPosition(new Vector3());
  const handWorld = hand.getWorldQuaternion(new Quaternion());
  const lab = a.distanceTo(b);
  const lbc = b.distanceTo(c);
  const lat = Math.min(
    lab + lbc - 1e-4,
    Math.max(Math.abs(lab - lbc) + 1e-4, a.distanceTo(target)),
  );

  // 1. Dobra o cotovelo até a distância ombro–punho ficar certa.
  const ba = a.clone().sub(b).normalize();
  const bc = c.clone().sub(b).normalize();
  const current = Math.acos(Math.min(1, Math.max(-1, ba.dot(bc))));
  const wanted = Math.acos(
    Math.min(1, Math.max(-1, (lab * lab + lbc * lbc - lat * lat) / (2 * lab * lbc))),
  );
  let axis = ba.clone().cross(bc);
  if (axis.lengthSq() < 1e-8) {
    // Braço esticado: dobra o antebraço para a frente (+Z), como um cotovelo natural.
    axis = new Vector3(0, 0, 1).cross(c.clone().sub(a));
  }
  axis.normalize();
  rotateWorld(lower, new Quaternion().setFromAxisAngle(axis, wanted - current));

  // 2. Gira o braço para o punho apontar para o alvo.
  const reached = hand.getWorldPosition(new Vector3()).sub(a).normalize();
  const desired = target.clone().sub(a).normalize();
  rotateWorld(upper, new Quaternion().setFromUnitVectors(reached, desired));

  // 3. Devolve à mão a orientação que ela tinha.
  const parent = lower.getWorldQuaternion(new Quaternion());
  hand.quaternion.copy(parent.invert().multiply(handWorld));
  hand.updateMatrixWorld(true);
  return true;
}

/**
 * Corrige a pose para os contatos: calcula, para cada mão, quanto o punho precisa andar
 * para cada ponto chegar ao alvo (média ponderada pelos pesos) e resolve o braço com IK.
 * Quando as duas mãos se tocam, cada uma anda metade do caminho.
 */
export function applyContacts(
  bone: BoneLookup,
  root: Object3D,
  contacts: readonly ContactSample[],
  options: Partial<ContactOptions> = {},
): ContactReport {
  const { maxShift } = { ...DEFAULT_CONTACT_OPTIONS, ...options };
  const report: ContactReport = { shift: { left: 0, right: 0 }, residuals: [] };
  if (contacts.length === 0) return report;
  root.updateMatrixWorld(true);

  const mutual = new Set(
    SIDES.filter((side) => contacts.some((c) => c.side === side && c.anchor === "hand")),
  );
  const shifts = new Map<HandSide, Vector3>();
  const measured: Array<{ contact: ContactSample; target: Vector3; frame: AnchorFrame }> = [];
  for (const side of SIDES) {
    const own = contacts.filter((c) => c.side === side);
    if (own.length === 0) continue;
    const sum = new Vector3();
    let total = 0;
    for (const contact of own) {
      const frame = anchorFrame(bone, contact);
      const point = handPoint(bone, side, contact.point);
      if (!frame || !point) continue;
      const target = targetOf(frame, contact);
      const delta = target.clone().sub(point);
      if (contact.anchor === "hand" && mutual.size === 2) delta.multiplyScalar(0.5);
      sum.addScaledVector(delta, contact.weight);
      total += contact.weight;
      measured.push({ contact, target, frame });
    }
    if (total === 0) continue;
    // Pesos somando mais que 1 viram média; menos que 1 deixam parte da pose original.
    const shift = sum.divideScalar(Math.max(1, total));
    if (shift.length() > maxShift) shift.setLength(maxShift);
    shifts.set(side, shift);
  }

  const before = measured.map(({ contact, target, frame }) => {
    const point = handPoint(bone, contact.side, contact.point);
    return point ? point.distanceTo(target) / frame.scale : 0;
  });
  for (const [side, shift] of shifts) {
    const wrist = pos(bone, `${side}Hand`);
    if (!wrist) continue;
    solveArm(bone, side, wrist.add(shift));
    report.shift[side] = shift.length();
  }
  root.updateMatrixWorld(true);
  measured.forEach(({ contact, frame }, i) => {
    // O alvo da outra mão também andou: recalcula com a pose final.
    const target = targetOf(anchorFrame(bone, contact) ?? frame, contact);
    const point = handPoint(bone, contact.side, contact.point);
    report.residuals.push({
      contact,
      before: before[i] ?? 0,
      after: point ? point.distanceTo(target) / frame.scale : 0,
    });
  });
  return report;
}
