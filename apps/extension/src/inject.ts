/**
 * Funções executadas dentro da aba via `chrome.scripting.executeScript`. O
 * Chrome serializa o corpo da função, então elas não podem usar nada de fora
 * dela: nem imports, nem constantes do módulo.
 */

/** Põe o overlay (página da extensão) num canto da página. Repetir não duplica. */
export function injectOverlay(url: string, extensionOrigin: string): void {
  type State = { frame: HTMLIFrameElement; onMessage: (event: MessageEvent) => void };
  const scope = window as unknown as { __autolibrasOverlay?: State };
  if (scope.__autolibrasOverlay?.frame.isConnected) return;

  const corners = [
    ["bottom", "right"],
    ["bottom", "left"],
    ["top", "left"],
    ["top", "right"],
  ] as const;
  let corner = 0;

  const frame = document.createElement("iframe");
  frame.id = "autolibras-overlay";
  frame.src = url;
  frame.title = "AutoLibras: tradução em Libras";
  frame.allow = "autoplay";
  const place = () => {
    Object.assign(frame.style, {
      position: "fixed",
      top: "auto",
      right: "auto",
      bottom: "auto",
      left: "auto",
      width: "340px",
      height: "560px",
      maxHeight: "calc(100vh - 32px)",
      border: "0",
      borderRadius: "14px",
      boxShadow: "0 8px 32px rgb(0 0 0 / 35%)",
      zIndex: "2147483647",
      colorScheme: "normal",
      background: "transparent",
    });
    const [vertical, horizontal] = corners[corner] as readonly [string, string];
    frame.style.setProperty(vertical, "16px");
    frame.style.setProperty(horizontal, "16px");
  };
  place();

  // O overlay pede para trocar de canto; só aceita mensagens dele mesmo.
  const onMessage = (event: MessageEvent) => {
    if (event.origin !== extensionOrigin || event.source !== frame.contentWindow) return;
    if ((event.data as { type?: unknown } | null)?.type === "autolibras:move") {
      corner = (corner + 1) % corners.length;
      place();
    }
  };
  window.addEventListener("message", onMessage);
  document.documentElement.appendChild(frame);
  scope.__autolibrasOverlay = { frame, onMessage };
}

export function removeOverlay(): void {
  type State = { frame: HTMLIFrameElement; onMessage: (event: MessageEvent) => void };
  const scope = window as unknown as { __autolibrasOverlay?: State };
  const state = scope.__autolibrasOverlay;
  if (!state) return;
  window.removeEventListener("message", state.onMessage);
  state.frame.remove();
  scope.__autolibrasOverlay = undefined;
}
