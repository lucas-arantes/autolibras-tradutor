/**
 * Service worker: inicia e encerra a tradução de uma aba. O áudio é capturado
 * num documento offscreen (service workers não têm acesso a mídia) e o avatar
 * aparece num overlay injetado na página. Uma aba por vez.
 */
import { injectOverlay, removeOverlay } from "./inject";
import type {
  BackgroundRequest,
  BackgroundResponse,
  CaptureEvent,
  OffscreenRequest,
  Session,
} from "./messages";
import { loadSettings } from "./settings";

// O Chrome encerra o service worker quando ocioso; o estado fica no storage da sessão.
async function getSession(): Promise<Session | null> {
  const { session } = await chrome.storage.session.get("session");
  return (session as Session | undefined) ?? null;
}

async function setSession(session: Session | null): Promise<void> {
  if (session) await chrome.storage.session.set({ session });
  else await chrome.storage.session.remove("session");
  await chrome.action.setBadgeText({ text: session ? "ON" : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#0b5cad" });
}

async function ensureOffscreen(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (contexts.length > 0) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: "Capturar o áudio da aba para transcrever e traduzir para Libras.",
  });
}

/** Envia ao offscreen, esperando o documento recém-criado registrar o listener. */
async function sendToOffscreen(message: OffscreenRequest): Promise<BackgroundResponse> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = (await chrome.runtime.sendMessage(message).catch(() => undefined)) as
      | BackgroundResponse
      | undefined;
    if (response) return response;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { ok: false, error: "O documento de captura não respondeu." };
}

async function start(tabId: number, streamId: string): Promise<void> {
  if (await getSession()) await stop();
  const settings = await loadSettings();

  // O overlay entra antes da captura para receber desde o primeiro estado ou erro.
  const overlayUrl = chrome.runtime.getURL(`overlay.html?tab=${tabId}`);
  await chrome.scripting.executeScript({
    target: { tabId },
    func: injectOverlay,
    args: [overlayUrl, new URL(overlayUrl).origin],
  });
  await setSession({ tabId });

  await ensureOffscreen();
  const result = await sendToOffscreen({
    target: "offscreen",
    type: "start",
    tabId,
    streamId,
    serverUrl: settings.serverUrl,
  });
  if (!result.ok) {
    await stop();
    throw new Error(result.error ?? "Falha ao capturar o áudio da aba.");
  }
}

/** Guarda o último estado da captura da aba em andamento. */
async function record(tabId: number, changes: Partial<Session>): Promise<void> {
  const session = await getSession();
  if (session?.tabId === tabId) await setSession({ ...session, ...changes });
}

async function stop(): Promise<void> {
  const session = await getSession();
  await sendToOffscreen({ target: "offscreen", type: "stop" });
  await chrome.offscreen.closeDocument().catch(() => undefined);
  if (session) {
    await chrome.scripting
      .executeScript({ target: { tabId: session.tabId }, func: removeOverlay })
      .catch(() => undefined);
  }
  await setSession(null);
}

chrome.runtime.onMessage.addListener(
  (message: BackgroundRequest | CaptureEvent | OffscreenRequest, _sender, sendResponse) => {
    if ("target" in message) return false;
    const reply = (task: Promise<unknown>) => {
      task.then(
        (value) => sendResponse(value ?? { ok: true }),
        (error: unknown) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }),
      );
      return true;
    };
    switch (message.type) {
      case "start":
        return reply(start(message.tabId, message.streamId).then(() => ({ ok: true })));
      case "stop":
        return reply(stop().then(() => ({ ok: true })));
      case "status":
        return reply(getSession());
      case "capture-state":
        void record(message.tabId, { state: message.state });
        return false;
      case "capture-error":
        void record(message.tabId, { error: message.message }).then(() =>
          chrome.action.setBadgeText({ text: "!" }),
        );
        return false;
      default:
        return false;
    }
  },
);

chrome.tabs.onRemoved.addListener((tabId) => {
  void getSession().then((session) => {
    if (session?.tabId === tabId) void stop();
  });
});
