import { type VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import {
  Color,
  DirectionalLight,
  HemisphereLight,
  type Material,
  type Mesh,
  NeutralToneMapping,
  type Object3D,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  type SkinnedMesh,
  Timer,
  Vector3,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  type BodySample,
  type BodyVolume,
  type CollisionReport,
  fitBodyVolumes,
  resolveCollisions,
} from "./collision";
import { applyContacts, type BoneLookup, type ContactReport, type ContactSample } from "./contacts";
import type { Pose } from "./sign-pack";
import type { AvatarStage } from "./vrm-renderer";

export interface ThreeVrmStageOptions {
  canvas: HTMLCanvasElement;
  /** URL do modelo `.vrm`. */
  avatarUrl: string;
  /**
   * Cor de fundo (CSS). `null` ou `"transparent"` deixam o canvas transparente, para
   * desenhar o avatar por cima de outra coisa (overlay do OBS, por exemplo).
   */
  background?: string | null;
  /** Piscadas automáticas (só se o modelo tiver a expressão `blink`). */
  autoBlink?: boolean;
  /** Tira as mãos e os antebraços de dentro do corpo (padrão: sim). */
  collisions?: boolean;
}

/** Espaço de sinalização a enquadrar, em metros, em volta da cabeça e do quadril. */
const FRAME_ABOVE_HEAD = 0.26;
const FRAME_BELOW_HIPS = 0.02;
/** Largura mínima visível (braços abertos em sinais como QUAL). */
const FRAME_WIDTH = 1.0;

/** Palco three.js: carrega o VRM, enquadra o espaço de sinalização e desenha. */
export class ThreeVrmStage implements AvatarStage {
  readonly #options: ThreeVrmStageOptions;
  readonly #scene = new Scene();
  readonly #camera = new PerspectiveCamera(30, 1, 0.05, 20);
  #renderer?: WebGLRenderer;
  #vrm?: VRM;
  #resize?: ResizeObserver;
  #nextBlink = 2;
  #blinkTime = -1;
  #touched = new Set<string>();
  #span = { top: 1.8, bottom: 0.9 };
  #lastContacts?: ContactReport;
  #lastCollisions?: CollisionReport;
  #volumes: BodyVolume[] = [];

  constructor(options: ThreeVrmStageOptions) {
    this.#options = {
      ...options,
      background: options.background === undefined ? "#eef2f6" : options.background,
      autoBlink: options.autoBlink ?? true,
      collisions: options.collisions ?? true,
    };
  }

  get vrm(): VRM | undefined {
    return this.#vrm;
  }

  get camera(): PerspectiveCamera {
    return this.#camera;
  }

  /** Resultado da última correção de contatos (para diagnóstico). */
  get lastContacts(): ContactReport | undefined {
    return this.#lastContacts;
  }

  /** Resultado da última correção de colisões (para diagnóstico). */
  get lastCollisions(): CollisionReport | undefined {
    return this.#lastCollisions;
  }

  /** Volumes do corpo ajustados à malha do modelo. */
  get volumes(): readonly BodyVolume[] {
    return this.#volumes;
  }

  /** Liga ou desliga a correção de colisões das mãos com o corpo. */
  setCollisions(enabled: boolean): void {
    this.#options.collisions = enabled;
  }

  get expressionNames(): readonly string[] {
    return Object.keys(this.#vrm?.expressionManager?.expressionMap ?? {});
  }

  async load(): Promise<void> {
    if (this.#vrm) return;
    const { canvas, avatarUrl } = this.#options;
    // Com alpha sempre ligado, o fundo pode virar transparente depois (setBackground).
    // A cor sai pré-multiplicada pelo alfa, como o OBS e os navegadores esperam.
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    // Neutral (Khronos PBR Neutral) preserva matiz e saturação: o tom de pele não muda.
    renderer.toneMapping = NeutralToneMapping;
    this.#renderer = renderer;
    this.setBackground(this.#options.background ?? null);
    // Luz de estúdio suave: o ambiente refletido (pele e olhos) e o hemisfério preenchem as
    // sombras; a luz principal modela o rosto e a contraluz separa cabelo e mãos do fundo.
    const pmrem = new PMREMGenerator(renderer);
    this.#scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.#scene.environmentIntensity = 0.35;
    pmrem.dispose();
    this.#scene.add(new HemisphereLight(0xffffff, 0x9aa4b0, 0.8));
    const lights: Array<[number, number, number, number, number]> = [
      [0xfff4e8, 1.7, 0.9, 1.9, 2.4],
      [0xffffff, 1.2, -0.4, 2.2, -1.8],
    ];
    for (const [color, intensity, x, y, z] of lights) {
      const light = new DirectionalLight(color, intensity);
      light.position.set(x, y, z);
      this.#scene.add(light);
    }

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(avatarUrl);
    const vrm = gltf.userData.vrm as VRM | undefined;
    if (!vrm) throw new Error("O arquivo do avatar não é um VRM");
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    VRMUtils.rotateVRM0(vrm);
    vrm.scene.traverse((obj) => {
      obj.frustumCulled = false;
      // Cabelo e cílios com recorte de alfa: alpha-to-coverage suaviza a borda com o MSAA.
      const mesh = obj as Mesh;
      const materials = mesh.isMesh ? ([] as Material[]).concat(mesh.material) : [];
      for (const material of materials) {
        if (material.alphaTest > 0) material.alphaToCoverage = true;
      }
    });
    this.#scene.add(vrm.scene);
    this.#vrm = vrm;
    vrm.scene.updateMatrixWorld(true);
    this.#volumes = fitBodyVolumes(vrmBodySamples(vrm), (name) =>
      vrm.humanoid.getNormalizedBoneNode(name as never),
    );
    if (vrm.lookAt) vrm.lookAt.target = this.#camera;

    this.#frame();
    this.#resize = new ResizeObserver(() => this.#fit());
    this.#resize.observe(canvas);
    this.#fit();
  }

  /** Troca a cor de fundo; `null` ou `"transparent"` deixam o canvas transparente. */
  setBackground(background: string | null): void {
    const transparent = background === null || background === "transparent";
    this.#options.background = transparent ? null : background;
    this.#scene.background = transparent ? null : new Color(background);
  }

  /** O canvas está com fundo transparente. */
  get transparent(): boolean {
    return this.#options.background === null;
  }

  /** Mede o espaço de sinalização: do alto da cabeça ao quadril. */
  #frame(): void {
    const vrm = this.#vrm;
    if (!vrm) return;
    vrm.scene.updateMatrixWorld(true);
    const head = vrm.humanoid.getNormalizedBoneNode("head")?.getWorldPosition(new Vector3());
    const hips = vrm.humanoid.getNormalizedBoneNode("hips")?.getWorldPosition(new Vector3());
    this.#span = {
      top: (head?.y ?? 1.55) + FRAME_ABOVE_HEAD,
      bottom: (hips?.y ?? 0.9) - FRAME_BELOW_HIPS,
    };
  }

  /** Ajusta a câmera ao tamanho do canvas, sem cortar a cabeça nem os braços abertos. */
  #fit(): void {
    const renderer = this.#renderer;
    if (!renderer) return;
    const canvas = renderer.domElement;
    const width = canvas.clientWidth || canvas.width;
    const height = canvas.clientHeight || canvas.height;
    if (canvas.width !== Math.round(width * renderer.getPixelRatio())) {
      renderer.setSize(width, height, false);
    }
    const camera = this.#camera;
    camera.aspect = width / height;
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    const { top, bottom } = this.#span;
    const distance = Math.max((top - bottom) / 2 / tan, FRAME_WIDTH / 2 / (tan * camera.aspect));
    // Num canvas alto, a largura dos braços decide a distância e sobra altura. A
    // sobra vai para baixo do quadril, e não para cima da cabeça, onde só ficaria vazio.
    const halfHeight = distance * tan;
    const center = Math.min((top + bottom) / 2, top - halfHeight);
    camera.position.set(0, center + 0.04, distance + 0.1);
    camera.lookAt(0, center, 0);
    camera.updateProjectionMatrix();
  }

  render(
    pose: Pose,
    expressions: ReadonlyMap<string, number>,
    dt: number,
    contacts: readonly ContactSample[] = [],
  ): void {
    const vrm = this.#vrm;
    const renderer = this.#renderer;
    if (!vrm || !renderer) return;
    const bone = (name: string) => vrm.humanoid.getNormalizedBoneNode(name as never);
    const result = poseSkeleton(
      bone,
      vrm.scene,
      pose,
      contacts,
      this.#options.collisions ? this.#volumes : [],
    );
    this.#lastContacts = result.contacts;
    this.#lastCollisions = result.collisions;
    const manager = vrm.expressionManager;
    if (manager) {
      for (const name of this.#touched) manager.setValue(name, 0);
      this.#touched.clear();
      for (const [name, weight] of expressions) {
        manager.setValue(name, weight);
        this.#touched.add(name);
      }
      if (this.#options.autoBlink && manager.getExpression("blink")) this.#blink(dt);
    }
    vrm.update(dt);
    renderer.render(this.#scene, this.#camera);
  }

  #blink(dt: number): void {
    const manager = this.#vrm?.expressionManager;
    if (!manager) return;
    this.#nextBlink -= dt;
    if (this.#nextBlink <= 0 && this.#blinkTime < 0) {
      this.#blinkTime = 0;
      this.#nextBlink = 2.5 + Math.random() * 3;
    }
    if (this.#blinkTime >= 0) {
      this.#blinkTime += dt;
      const w = Math.max(0, 1 - Math.abs(this.#blinkTime - 0.08) / 0.08);
      manager.setValue("blink", w);
      this.#touched.add("blink");
      if (this.#blinkTime > 0.16) this.#blinkTime = -1;
    }
  }

  start(tick: (dt: number) => void): () => void {
    const timer = new Timer();
    // Com a aba escondida, o Timer não acumula o tempo parado.
    timer.connect(document);
    let handle = 0;
    const loop = (time: number) => {
      handle = requestAnimationFrame(loop);
      timer.update(time);
      tick(Math.min(timer.getDelta(), 0.1));
    };
    handle = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(handle);
      timer.disconnect();
    };
  }

  dispose(): void {
    this.#resize?.disconnect();
    if (this.#vrm) VRMUtils.deepDispose(this.#vrm.scene);
    this.#renderer?.dispose();
    this.#vrm = undefined;
    this.#renderer = undefined;
  }
}

/**
 * Põe a pose nos ossos normalizados, corrige os contatos e depois as colisões com o corpo.
 * É o que o palco faz a cada quadro antes de desenhar.
 */
export function poseSkeleton(
  bone: BoneLookup,
  root: Object3D,
  pose: Pose,
  contacts: readonly ContactSample[],
  volumes: readonly BodyVolume[],
): { contacts?: ContactReport; collisions?: CollisionReport } {
  for (const [name, q] of pose) bone(name)?.quaternion.copy(q);
  return {
    contacts: contacts.length ? applyContacts(bone, root, contacts) : undefined,
    collisions: volumes.length ? resolveCollisions(bone, root, volumes, contacts) : undefined,
  };
}

/**
 * Vértices das malhas do VRM na pose atual, cada um com o osso humanoide que mais pesa
 * nele (ossos fora do humanoide, como os do cabelo, contam como o ancestral humanoide).
 */
export function vrmBodySamples(vrm: VRM): BodySample[] {
  const humanoid = new Map<Object3D, string>();
  for (const name of Object.keys(vrm.humanoid.humanBones)) {
    const node = vrm.humanoid.getRawBoneNode(name as never);
    if (node) humanoid.set(node, name);
  }
  const owner = (node: Object3D | null): string | undefined => {
    for (let n = node; n; n = n.parent) {
      const name = humanoid.get(n);
      if (name) return name;
    }
    return undefined;
  };
  const samples: BodySample[] = [];
  vrm.scene.traverse((obj) => {
    const mesh = obj as SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const { skinIndex, skinWeight, position } = mesh.geometry.attributes;
    if (!skinIndex || !skinWeight || !position) return;
    const owners = mesh.skeleton.bones.map((b) => owner(b));
    for (let i = 0; i < position.count; i++) {
      let best = 0;
      let index = 0;
      for (let k = 0; k < skinIndex.itemSize; k++) {
        const w = skinWeight.getComponent(i, k);
        if (w > best) {
          best = w;
          index = skinIndex.getComponent(i, k);
        }
      }
      const bone = owners[index];
      if (!bone) continue;
      const v = new Vector3();
      mesh.getVertexPosition(i, v);
      mesh.applyBoneTransform(i, v);
      samples.push({ position: v.applyMatrix4(mesh.matrixWorld), bone });
    }
  });
  return samples;
}
