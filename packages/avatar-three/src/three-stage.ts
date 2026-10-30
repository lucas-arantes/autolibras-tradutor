import { type VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import {
  Color,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  Timer,
  Vector3,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Pose } from "./sign-pack";
import type { AvatarStage } from "./vrm-renderer";

export interface ThreeVrmStageOptions {
  canvas: HTMLCanvasElement;
  /** URL do modelo `.vrm`. */
  avatarUrl: string;
  /** Cor de fundo; `null` deixa o canvas transparente. */
  background?: string | null;
  /** Piscadas automáticas (só se o modelo tiver a expressão `blink`). */
  autoBlink?: boolean;
}

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

  constructor(options: ThreeVrmStageOptions) {
    this.#options = { background: "#eef2f6", autoBlink: true, ...options };
  }

  get vrm(): VRM | undefined {
    return this.#vrm;
  }

  get expressionNames(): readonly string[] {
    return Object.keys(this.#vrm?.expressionManager?.expressionMap ?? {});
  }

  async load(): Promise<void> {
    if (this.#vrm) return;
    const { canvas, avatarUrl, background } = this.#options;
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: background === null });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer = renderer;
    if (background) this.#scene.background = new Color(background);
    this.#scene.add(new HemisphereLight(0xffffff, 0x8899aa, 1.6));
    const key = new DirectionalLight(0xffffff, 2.2);
    key.position.set(0.6, 1.8, 2.2);
    this.#scene.add(key);

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
    });
    this.#scene.add(vrm.scene);
    this.#vrm = vrm;
    if (vrm.lookAt) vrm.lookAt.target = this.#camera;

    this.#frame();
    this.#resize = new ResizeObserver(() => this.#fit());
    this.#resize.observe(canvas);
    this.#fit();
  }

  /** Enquadra da cabeça à cintura, com espaço para os braços abertos. */
  #frame(): void {
    const vrm = this.#vrm;
    if (!vrm) return;
    vrm.scene.updateMatrixWorld(true);
    const head = vrm.humanoid.getNormalizedBoneNode("head")?.getWorldPosition(new Vector3());
    const hips = vrm.humanoid.getNormalizedBoneNode("hips")?.getWorldPosition(new Vector3());
    const top = (head?.y ?? 1.5) + 0.32;
    const bottom = (hips?.y ?? 0.9) - 0.05;
    const center = new Vector3(0, (top + bottom) / 2, 0);
    const distance = (top - bottom) / 2 / Math.tan((this.#camera.fov * Math.PI) / 360) + 0.2;
    this.#camera.position.set(0, center.y + 0.05, distance);
    this.#camera.lookAt(center);
  }

  #fit(): void {
    const renderer = this.#renderer;
    if (!renderer) return;
    const canvas = renderer.domElement;
    const width = canvas.clientWidth || canvas.width;
    const height = canvas.clientHeight || canvas.height;
    if (canvas.width !== Math.round(width * renderer.getPixelRatio())) {
      renderer.setSize(width, height, false);
    }
    this.#camera.aspect = width / height;
    this.#camera.updateProjectionMatrix();
  }

  render(pose: Pose, expressions: ReadonlyMap<string, number>, dt: number): void {
    const vrm = this.#vrm;
    const renderer = this.#renderer;
    if (!vrm || !renderer) return;
    for (const [bone, q] of pose) {
      vrm.humanoid.getNormalizedBoneNode(bone as never)?.quaternion.copy(q);
    }
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
