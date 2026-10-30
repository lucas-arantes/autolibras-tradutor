/**
 * Formulário público de retorno: quem assiste diz se entendeu a sinalização.
 * A pergunta também aparece em Libras, pelo avatar, porque muitas pessoas
 * surdas leem português com dificuldade.
 *
 * Parâmetros da URL: `f` (chave da sessão, mostrada no Estúdio), `server`
 * (endereço do servidor; padrão, o próprio endereço desta página) e `signs`
 * (pacote de sinais; padrão, o do build).
 */
import { toGloss } from "@autolibras/gloss-rules";
import { createAvatar, SIGN_PACK_URL } from "./lib/avatar";
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

const QUESTION = "Você entendeu a tradução em Libras?";
const ANSWERS: Record<string, string> = { good: "Entendi.", bad: "Não entendi." };

/** Avatar que faz a pergunta em Libras. Sem pacote de sinais, o formulário fica só em texto. */
async function signQuestion(): Promise<void> {
  const signsUrl = params.get("signs")?.trim() || SIGN_PACK_URL;
  const box = document.getElementById("sign");
  const canvas = box?.querySelector("canvas");
  if (!signsUrl || !box || !canvas) return;
  box.hidden = false;
  try {
    const { renderer } = await createAvatar("propio", { signsUrl, canvas, background: null });
    await renderer.load();
    let playing = Promise.resolve();
    const sign = (text: string) => {
      renderer.stop();
      playing = playing.then(() => renderer.play(toGloss(text)));
    };
    sign(QUESTION);
    document.getElementById("replay")?.addEventListener("click", () => sign(QUESTION));
    // Ao escolher uma resposta, o avatar a confirma em Libras.
    for (const input of form.querySelectorAll<HTMLInputElement>("input[name=rating]")) {
      input.addEventListener("change", () => sign(ANSWERS[input.value] ?? ""));
    }
  } catch {
    // Sem WebGL ou sem rede para os sinais: o formulário continua em texto.
    box.hidden = true;
  }
}

void signQuestion();
