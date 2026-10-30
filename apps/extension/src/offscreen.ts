/**
 * Documento offscreen: recebe o áudio da aba (`tabCapture`), devolve o som para
 * os alto-falantes (a captura silencia a aba) e transcreve pelo servidor Whisper.
 * As transcrições vão para as páginas da extensão; o overlay da aba as exibe.
 */
import { captureStream, RemoteWhisperRecognizer } from "@autolibras/stt-web";
import type { BackgroundResponse, CaptureEvent, OffscreenRequest } from "./messages";

let recognizer: RemoteWhisperRecognizer | undefined;
let stream: MediaStream | undefined;

function broadcast(event: CaptureEvent): void {
  chrome.runtime.sendMessage(event).catch(() => undefined);
}

function release(): void {
  recognizer?.stop();
  recognizer = undefined;
  // Encerrar as trilhas devolve o áudio à aba mesmo se a captura falhou no meio.
  for (const track of stream?.getTracks() ?? []) track.stop();
  stream = undefined;
}

async function start(tabId: number, streamId: string, serverUrl: string): Promise<void> {
  release();
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId },
    } as MediaTrackConstraints,
    video: false,
  });
  const current = new RemoteWhisperRecognizer({
    url: serverUrl,
    captureAudio: captureStream(stream, { playback: true }),
  });
  current.on("transcript", (segment) =>
    broadcast({
      type: "transcript",
      tabId,
      id: segment.id,
      text: segment.text,
      isFinal: segment.isFinal,
    }),
  );
  current.on("state", (state) => {
    broadcast({ type: "capture-state", tabId, state });
    if (state === "error") release();
  });
  current.on("error", (error) =>
    broadcast({ type: "capture-error", tabId, message: error.message }),
  );
  recognizer = current;
  current.start();
}

chrome.runtime.onMessage.addListener((message: OffscreenRequest, _sender, sendResponse) => {
  if (message.target !== "offscreen") return false;
  if (message.type === "stop") {
    release();
    sendResponse({ ok: true } satisfies BackgroundResponse);
    return false;
  }
  start(message.tabId, message.streamId, message.serverUrl).then(
    () => sendResponse({ ok: true } satisfies BackgroundResponse),
    (error: unknown) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies BackgroundResponse),
  );
  return true;
});
