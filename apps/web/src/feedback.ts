/**
 * Formulário público de retorno: quem assiste diz se entendeu a sinalização.
 *
 * Parâmetros da URL: `f` (chave da sessão, mostrada no Estúdio) e `server`
 * (endereço do servidor; padrão, o próprio endereço desta página).
 */
import "./app.css";
import "./feedback.css";

const params = new URLSearchParams(location.search);
const form = document.getElementById("form") as HTMLFormElement;
const status = document.getElementById("status") as HTMLElement;
const server = params.get("server") || location.origin;
const endpoint = new URL("v1/feedback", server.endsWith("/") ? server : `${server}/`);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const body = JSON.stringify({
    rating: data.get("rating"),
    comment: data.get("comment") ?? "",
    key: params.get("f") ?? "",
    source: "form",
  });
  const button = form.querySelector("button");
  if (button) button.disabled = true;
  try {
    // Como texto, sem cabeçalhos extras: funciona mesmo se a página e o servidor
    // estiverem em endereços diferentes.
    const response = await fetch(endpoint, { method: "POST", body });
    if (response.status === 429) throw new Error("Muitos envios seguidos. Tente daqui a pouco.");
    if (!response.ok) throw new Error(`Erro ${response.status} no servidor.`);
    for (const el of form.querySelectorAll("fieldset, label.field, button")) el.remove();
    status.textContent = "Obrigado! A sua resposta foi enviada.";
  } catch (error) {
    if (button) button.disabled = false;
    status.textContent =
      error instanceof Error && error.message.startsWith("Muitos")
        ? error.message
        : "Não foi possível enviar agora. Tente de novo em instantes.";
  }
});
