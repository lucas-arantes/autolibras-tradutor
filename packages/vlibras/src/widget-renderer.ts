import { type AvatarRenderer, countSigns } from "@autolibras/core";

export type VLibrasAvatar = "icaro" | "hosana" | "guga";
export type VLibrasStatus = "idle" | "playing" | "paused" | "stopped";

/** Parte do objeto `window.vlibras` que o Widget publica depois de carregar o player. */
export interface VLibrasGlobal {
  status?: VLibrasStatus;
  play(gloss?: string): void;
  stop(): void;
  setSpeed(speed: number): void;
  toggleAvatar?(avatar?: VLibrasAvatar): void;
}

declare global {
  interface Window {
    VLibras?: { Widget: new (options: Record<string, unknown>) => unknown };
    VLibrasWidget?: { open?: (auto?: boolean) => void };
    vlibras?: VLibrasGlobal;
  }
}

export const VLIBRAS_ROOT_PATH = "https://vlibras.gov.br/app";

export interface VLibrasWidgetRendererOptions {
  rootPath?: string;
  avatar?: VLibrasAvatar;
  position?: "L" | "R";
  /** Tempo máximo para baixar e iniciar o player Unity. */
  loadTimeoutMs?: number;
  /** Tempo máximo para um sinal começar (inclui baixar as animações). */
  startTimeoutMs?: number;
  pollMs?: number;
}

/** Espera `predicate` ficar verdadeiro, consultando a cada `pollMs`. */
export function waitFor(predicate: () => boolean, timeoutMs: number, pollMs = 100): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() >= deadline) return reject(new Error("Tempo esgotado"));
      setTimeout(check, pollMs);
    };
    check();
  });
}

function loadScript(src: string): Promise<void> {
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
  if (existing?.dataset.loaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    });
    script.addEventListener("error", () => reject(new Error(`Falha ao carregar ${src}`)));
    if (!existing) {
      script.src = src;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

/**
 * Avatar do VLibras via Widget oficial, carregado da infraestrutura do governo em
 * tempo de execução (nenhum código ou asset do VLibras é redistribuído aqui).
 * A glosa vai direto para o player, sem passar pelo tradutor do Widget.
 */
export class VLibrasWidgetRenderer implements AvatarRenderer {
  readonly name = "vlibras";
  readonly #options: Required<VLibrasWidgetRendererOptions>;
  #loading?: Promise<void>;
  #playId = 0;

  constructor(options: VLibrasWidgetRendererOptions = {}) {
    this.#options = {
      rootPath: VLIBRAS_ROOT_PATH,
      avatar: "icaro",
      position: "R",
      loadTimeoutMs: 90_000,
      startTimeoutMs: 15_000,
      pollMs: 100,
      ...options,
    };
  }

  get loaded(): boolean {
    return typeof window !== "undefined" && typeof window.vlibras?.play === "function";
  }

  load(): Promise<void> {
    this.#loading ??= this.#load().catch((error: unknown) => {
      this.#loading = undefined;
      throw error;
    });
    return this.#loading;
  }

  async #load(): Promise<void> {
    if (this.loaded) return;
    const { rootPath, avatar, position, loadTimeoutMs, pollMs } = this.#options;
    await loadScript(`${rootPath}/vlibras-plugin.js`);
    if (!window.VLibras?.Widget) throw new Error("O script do VLibras não expôs VLibras.Widget");
    new window.VLibras.Widget({ rootPath, avatar, position });
    window.VLibrasWidget?.open?.();
    await waitFor(() => this.loaded, loadTimeoutMs, pollMs).catch(() => {
      throw new Error("O avatar do VLibras não carregou a tempo");
    });
  }

  async play(gloss: string): Promise<void> {
    const api = window.vlibras;
    if (!api) throw new Error("Avatar do VLibras não carregado");
    const id = ++this.#playId;
    const { startTimeoutMs, pollMs } = this.#options;
    const status = () => window.vlibras?.status;
    const superseded = () => id !== this.#playId;

    api.play(gloss);
    try {
      await waitFor(() => superseded() || status() === "playing", startTimeoutMs, pollMs);
    } catch {
      // Não começou (sinal indisponível ou já terminou antes da primeira consulta).
      return;
    }
    // Limite de segurança para não travar a fila se o status nunca voltar a "idle".
    const maxDurationMs = 30_000 + countSigns(gloss) * 5_000;
    await waitFor(
      () => superseded() || status() === "idle" || status() === "stopped",
      maxDurationMs,
      pollMs,
    ).catch(() => undefined);
  }

  stop(): void {
    this.#playId++;
    window.vlibras?.stop();
  }

  setSpeed(speed: number): void {
    window.vlibras?.setSpeed(speed);
  }

  setAvatar(avatar: VLibrasAvatar): void {
    this.#options.avatar = avatar;
    window.vlibras?.toggleAvatar?.(avatar);
  }
}
