import type { AvatarRenderer } from "@autolibras/core";
import type { VLibrasAvatar } from "@autolibras/vlibras";

/**
 * Avatares que o app sabe usar:
 * - `vlibras`: player Unity do VLibras, carregado do governo (padrão enquanto não houver
 *   pacote de sinais). Os termos de uso do VLibras não permitem tradução automática em
 *   produções audiovisuais, então ele não serve para transmissões;
 * - `propio`: avatar VRM do AutoLibras (`@autolibras/avatar-three`), com o pacote de
 *   sinais GPL-3.0 publicado à parte e carregado por URL.
 */
export type AvatarKind = "vlibras" | "propio";

/** Pacote de sinais definido no build (`VITE_SIGN_PACK_URL`), ou vazio. */
export const SIGN_PACK_URL: string = (import.meta.env.VITE_SIGN_PACK_URL ?? "").trim();

/** Lê `avatar=propio|vlibras` (aceita também `proprio` e `próprio`). */
export function parseAvatarKind(value: string | null | undefined): AvatarKind | null {
  const plain = value
    ?.normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
  if (plain === "vlibras") return "vlibras";
  if (plain === "propio" || plain === "proprio") return "propio";
  return null;
}

/** O avatar próprio só é o padrão quando há um pacote de sinais configurado. */
export function defaultAvatarKind(signsUrl: string = SIGN_PACK_URL): AvatarKind {
  return signsUrl ? "propio" : "vlibras";
}

export interface CreateAvatarOptions {
  /** Personagem do VLibras (`icaro`, `hosana`, `guga`). */
  vlibrasAvatar?: VLibrasAvatar;
  /** URL do pacote de sinais (pasta com `manifest.json`); padrão: `SIGN_PACK_URL`. */
  signsUrl?: string;
  /** URL de outro modelo `.vrm`; padrão: o modelo do AutoLibras. */
  avatarUrl?: string;
  /** Canvas onde desenhar o avatar próprio; sem ele, um canvas novo é criado. */
  canvas?: HTMLCanvasElement;
  /** Fundo do avatar próprio: cor CSS, ou `null` para transparente (overlay do OBS). */
  background?: string | null;
  /** Peso das expressões gravadas nos sinais, de 0 a 1. */
  faceWeight?: number;
}

export interface AvatarHandle {
  kind: AvatarKind;
  renderer: AvatarRenderer;
  /** Canvas do avatar próprio, para pôr na página; `null` no VLibras (ele cria a própria janela). */
  canvas: HTMLCanvasElement | null;
  /** Troca o fundo (só no avatar próprio). */
  setBackground(background: string | null): void;
  dispose(): void;
}

/**
 * Cria o avatar escolhido. É o ponto de entrada comum da página principal, do
 * `player.html` e do overlay de transmissão (`avatar=propio|vlibras` na URL).
 *
 * Os dois renderers são carregados sob demanda, para quem usa um não baixar o outro.
 */
export async function createAvatar(
  kind: AvatarKind,
  options: CreateAvatarOptions = {},
): Promise<AvatarHandle> {
  if (kind === "vlibras") {
    const { VLibrasWidgetRenderer } = await import("@autolibras/vlibras");
    const renderer = new VLibrasWidgetRenderer({ avatar: options.vlibrasAvatar ?? "icaro" });
    setVLibrasWidgetHidden(false);
    return {
      kind,
      renderer,
      canvas: null,
      setBackground: () => undefined,
      dispose: () => {
        renderer.stop();
        setVLibrasWidgetHidden(true);
      },
    };
  }
  const signsUrl = (options.signsUrl ?? SIGN_PACK_URL).trim();
  if (!signsUrl) throw new Error("Pacote de sinais não configurado para o avatar próprio");
  const { createVrmRenderer } = await import("@autolibras/avatar-three");
  const canvas = options.canvas ?? document.createElement("canvas");
  const renderer = createVrmRenderer({
    canvas,
    signs: signsUrl,
    avatarUrl: options.avatarUrl,
    background: options.background,
    faceWeight: options.faceWeight,
  });
  setVLibrasWidgetHidden(true);
  return {
    kind,
    renderer,
    canvas,
    setBackground: (background) => renderer.setBackground(background),
    dispose: () => renderer.dispose(),
  };
}

/** Esconde ou mostra a janela flutuante do Widget do VLibras (elemento `[vw]`). */
function setVLibrasWidgetHidden(hidden: boolean): void {
  if (typeof document === "undefined") return;
  for (const el of document.querySelectorAll<HTMLElement>("[vw]")) {
    el.style.display = hidden ? "none" : "";
  }
}

/**
 * Renderer que repassa tudo para o avatar atual e permite trocá-lo sem recriar a
 * fila (a `SignQueue` recebe o renderer uma vez só). Trocar interrompe o sinal atual.
 * Até o primeiro `use`, `load` e `play` esperam o avatar ficar disponível.
 */
export class SwitchableRenderer implements AvatarRenderer {
  #current: AvatarRenderer | null = null;
  #speed = 1;
  #resolveReady!: (renderer: AvatarRenderer) => void;
  readonly #ready = new Promise<AvatarRenderer>((resolve) => {
    this.#resolveReady = resolve;
  });

  get name(): string {
    return this.#current?.name ?? "nenhum";
  }

  get current(): AvatarRenderer | null {
    return this.#current;
  }

  /** Passa a usar `next`; o anterior para na hora. */
  use(next: AvatarRenderer): void {
    if (next === this.#current) return;
    this.#current?.stop();
    this.#current = next;
    next.setSpeed(this.#speed);
    this.#resolveReady(next);
  }

  async load(): Promise<void> {
    await (this.#current ?? (await this.#ready)).load();
  }

  async play(gloss: string): Promise<void> {
    await (this.#current ?? (await this.#ready)).play(gloss);
  }

  stop(): void {
    this.#current?.stop();
  }

  setSpeed(speed: number): void {
    this.#speed = speed;
    this.#current?.setSpeed(speed);
  }
}
