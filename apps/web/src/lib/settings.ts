import type { VLibrasAvatar } from "@autolibras/vlibras";
import { type AvatarKind, defaultAvatarKind, parseAvatarKind, SIGN_PACK_URL } from "./avatar";

export type TranslatorMode = "vlibras" | "regras";
export type RecognizerMode = "web-speech" | "whisper";

export interface Settings {
  recognizer: RecognizerMode;
  /** Endereço do servidor Whisper (`services/stt-server`). */
  whisperUrl: string;
  translator: TranslatorMode;
  /** Avatar que sinaliza: o do VLibras ou o próprio (VRM). */
  avatarKind: AvatarKind;
  /** Personagem do VLibras. */
  avatar: VLibrasAvatar;
  /** URL do pacote de sinais do avatar próprio (vazio: o definido no build). */
  signsUrl: string;
  /** Atraso máximo antes de descartar frases antigas, em segundos. */
  maxLagSeconds: number;
  /** Velocidade de sinalização quando a fila está em dia. */
  baseSpeed: number;
}

export const DEFAULT_SETTINGS: Settings = {
  recognizer: "web-speech",
  whisperUrl: "ws://localhost:8000/v1/stream",
  translator: "vlibras",
  avatarKind: defaultAvatarKind(),
  avatar: "icaro",
  signsUrl: "",
  maxLagSeconds: 15,
  baseSpeed: 1,
};

const KEY = "autolibras:settings";

export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Settings>;
    const settings = { ...DEFAULT_SETTINGS, ...saved };
    settings.avatarKind = parseAvatarKind(settings.avatarKind) ?? DEFAULT_SETTINGS.avatarKind;
    return settings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Pacote de sinais em uso: o da configuração ou, se vazio, o definido no build. */
export function signsUrlOf(settings: Settings): string {
  return settings.signsUrl.trim() || SIGN_PACK_URL;
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Armazenamento indisponível (aba anônima, bloqueio de cookies): segue sem salvar.
  }
}
