/**
 * Overlay sobre a página: mostra a legenda e embute o player do app (avatar do
 * VLibras), repassando a ele as frases finais transcritas da aba.
 */
import { type CaptureEvent, MOVE_MESSAGE, type Session } from "./messages";
import { loadSettings, playerSrc } from "./settings";

const tabId = Number(new URLSearchParams(location.search).get("tab"));
const player = document.getElementById("player") as HTMLIFrameElement;
const status = document.getElementById("status") as HTMLElement;
const caption = document.getElementById("caption") as HTMLElement;
const gloss = document.getElementById("gloss") as HTMLElement;
const errorBox = document.getElementById("error") as HTMLElement;

let playerOrigin = "";
let playerReady = false;
const waiting: string[] = [];

function showError(message: string): void {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function sendToPlayer(text: string): void {
  if (!playerReady) {
    waiting.push(text);
    return;
  }
  player.contentWindow?.postMessage({ type: "autolibras:text", text }, playerOrigin);
}

chrome.runtime.onMessage.addListener((message: CaptureEvent) => {
  if (!("tabId" in message) || message.tabId !== tabId) return;
  switch (message.type) {
    case "transcript":
      caption.textContent = message.text;
      caption.classList.toggle("partial", !message.isFinal);
      if (message.isFinal) sendToPlayer(message.text);
      break;
    case "capture-state":
      if (message.state === "listening") status.textContent = "Ouvindo a aba";
      else if (message.state === "error") status.textContent = "Parado por erro";
      break;
    case "capture-error":
      showError(message.message);
      break;
  }
});

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== player.contentWindow || event.origin !== playerOrigin) return;
  const data = event.data as { source?: string; type?: string; [key: string]: unknown };
  if (data?.source !== "autolibras-player") return;
  if (data.type === "ready") {
    playerReady = true;
    for (const text of waiting.splice(0)) sendToPlayer(text);
  } else if (data.type === "gloss" && typeof data.gloss === "string") {
    gloss.textContent = data.gloss;
  } else if (data.type === "queue" && typeof data.lagSeconds === "number") {
    status.textContent = data.pending
      ? `Sinalizando · atraso ≈ ${data.lagSeconds.toFixed(0)} s`
      : "Ouvindo a aba";
  } else if (data.type === "error" && typeof data.message === "string") {
    showError(data.message);
  }
});

document.getElementById("move")?.addEventListener("click", () => {
  window.parent.postMessage({ type: MOVE_MESSAGE }, "*");
});

document.getElementById("stop")?.addEventListener("click", () => {
  void chrome.runtime.sendMessage({ type: "stop" });
});

// Estado anterior à abertura do overlay (por exemplo, um erro logo no início).
void chrome.runtime.sendMessage({ type: "status" }).then((session: Session | null) => {
  if (session?.tabId !== tabId) return;
  if (session.state === "listening") status.textContent = "Ouvindo a aba";
  if (session.error) showError(session.error);
});

void loadSettings().then((settings) => {
  const src = playerSrc(settings);
  playerOrigin = new URL(src).origin;
  player.src = src;
});
