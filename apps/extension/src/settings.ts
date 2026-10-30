export type TranslatorMode = "vlibras" | "regras";
export type Avatar = "icaro" | "hosana" | "guga";

export interface ExtensionSettings {
  /** WebSocket do servidor Whisper (`services/stt-server`). */
  serverUrl: string;
  translator: TranslatorMode;
  avatar: Avatar;
  /** Página do player (avatar sozinho) do app publicado. */
  playerUrl: string;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  serverUrl: "ws://localhost:8000/v1/stream",
  translator: "vlibras",
  avatar: "icaro",
  playerUrl: "https://lucas-arantes.github.io/autolibras-tradutor/player.html",
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

function validUrl(
  value: unknown,
  protocols: string[],
  localOnly: string[] = [],
): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (protocols.includes(url.protocol)) return url.href;
    if (localOnly.includes(url.protocol) && LOCAL_HOSTS.has(url.hostname)) return url.href;
  } catch {
    // Valor inválido: fica o padrão.
  }
  return undefined;
}

/** Aceita só valores válidos e completa o resto com o padrão. */
export function normalizeSettings(raw: unknown): ExtensionSettings {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    serverUrl: validUrl(value.serverUrl, ["ws:", "wss:"]) ?? DEFAULT_SETTINGS.serverUrl,
    translator: value.translator === "regras" ? "regras" : "vlibras",
    avatar: value.avatar === "hosana" || value.avatar === "guga" ? value.avatar : "icaro",
    // O player roda código de outra origem: só HTTPS, ou HTTP local para desenvolvimento.
    playerUrl: validUrl(value.playerUrl, ["https:"], ["http:"]) ?? DEFAULT_SETTINGS.playerUrl,
  };
}

/** Endereço do player com as escolhas de tradutor e avatar. */
export function playerSrc(settings: ExtensionSettings): string {
  const url = new URL(settings.playerUrl);
  url.searchParams.set("translator", settings.translator);
  url.searchParams.set("avatar", settings.avatar);
  return url.href;
}

export async function loadSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get("settings");
  return normalizeSettings(stored.settings);
}

export async function saveSettings(settings: ExtensionSettings): Promise<ExtensionSettings> {
  const normalized = normalizeSettings(settings);
  await chrome.storage.local.set({ settings: normalized });
  return normalized;
}
