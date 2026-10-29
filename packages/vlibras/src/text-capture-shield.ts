/**
 * Marcador que o Widget usa para ignorar os próprios cliques sintéticos
 * (`__vlibrasSyntheticClick`, presente no Widget v7.x). Não é API pública:
 * se o Widget mudar, os cliques no app voltam a ser capturados.
 */
const SYNTHETIC_CLICK_FLAG = "__vlibrasSyntheticClick";

const HOVER_EVENTS = ["mouseover", "mouseout", "mousemove"] as const;

/**
 * Com o Widget aberto, o modo "clique para traduzir" intercepta todo clique na
 * página (com `preventDefault`) para sinalizar o texto clicado. Esta função
 * protege `element` disso, para os botões e campos do app funcionarem.
 */
export function shieldFromTextCapture(element: HTMLElement): () => void {
  // Captura em `window` roda antes do listener de captura do Widget em `document.body`.
  const markClick = (event: MouseEvent) => {
    if (event.target instanceof Node && element.contains(event.target)) {
      Object.defineProperty(event, SYNTHETIC_CLICK_FLAG, { value: true });
    }
  };
  // O realce de hover do Widget é instalado em `document.body` na fase de bolha.
  const stopHover = (event: Event) => event.stopPropagation();

  window.addEventListener("click", markClick, true);
  for (const type of HOVER_EVENTS) element.addEventListener(type, stopHover);

  return () => {
    window.removeEventListener("click", markClick, true);
    for (const type of HOVER_EVENTS) element.removeEventListener(type, stopHover);
  };
}
