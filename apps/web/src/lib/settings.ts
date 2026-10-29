import type { VLibrasAvatar } from "@autolibras/vlibras";

export type TranslatorMode = "vlibras" | "regras";

export interface Settings {
  translator: TranslatorMode;
  avatar: VLibrasAvatar;
  /** Atraso máximo antes de descartar frases antigas, em segundos. */
  maxLagSeconds: number;
  /** Velocidade de sinalização quando a fila está em dia. */
  baseSpeed: number;
}

export const DEFAULT_SETTINGS: Settings = {
  translator: "vlibras",
  avatar: "icaro",
  maxLagSeconds: 15,
  baseSpeed: 1,
};

const KEY = "autolibras:settings";

export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Armazenamento indisponível (aba anônima, bloqueio de cookies): segue sem salvar.
  }
}
