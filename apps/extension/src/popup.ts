import type { BackgroundResponse, Session } from "./messages";
import { type ExtensionSettings, loadSettings, saveSettings } from "./settings";

const state = document.getElementById("state") as HTMLElement;
const toggle = document.getElementById("toggle") as HTMLButtonElement;
const message = document.getElementById("message") as HTMLElement;
const form = document.getElementById("settings") as HTMLFormElement;

let session: Session | null = null;

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function render(): Promise<void> {
  session = (await chrome.runtime.sendMessage({ type: "status" })) as Session | null;
  const tab = await activeTab();
  const webPage = /^https?:/.test(tab?.url ?? "");
  if (session && session.tabId === tab?.id) {
    state.textContent = "Traduzindo esta aba.";
    toggle.textContent = "Parar";
    toggle.classList.add("stop");
    toggle.disabled = false;
  } else {
    state.textContent = session ? "Traduzindo outra aba." : "Parado.";
    toggle.textContent = session ? "Traduzir esta aba no lugar" : "Traduzir esta aba";
    toggle.classList.remove("stop");
    toggle.disabled = !webPage;
    if (!webPage) message.textContent = "Abra uma página da web, como um vídeo ou uma reunião.";
  }
}

toggle.addEventListener("click", async () => {
  message.textContent = "";
  toggle.disabled = true;
  try {
    const tab = await activeTab();
    if (session && session.tabId === tab?.id) {
      await chrome.runtime.sendMessage({ type: "stop" });
    } else if (tab?.id !== undefined) {
      // O clique no popup é o gesto do usuário que libera a captura da aba.
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
      const response = (await chrome.runtime.sendMessage({
        type: "start",
        tabId: tab.id,
        streamId,
      })) as BackgroundResponse;
      if (!response.ok) throw new Error(response.error);
    }
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : String(error);
  }
  await render();
});

function fillForm(settings: ExtensionSettings): void {
  for (const [name, value] of Object.entries(settings)) {
    const field = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
    if (field) field.value = value;
  }
}

form.addEventListener("change", async () => {
  const data = Object.fromEntries(new FormData(form)) as unknown as ExtensionSettings;
  fillForm(await saveSettings(data));
});

void loadSettings().then(fillForm);
void render();
