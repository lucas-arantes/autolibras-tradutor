/**
 * Demonstração do "closed signing": um player com o botão Libras.
 *
 * Parâmetros da URL: `video` (arquivo ou HLS `.m3u8`), `legendas` (WebVTT, se a
 * legenda não vier no vídeo), `signs` (pacote de sinais; padrão: o do build) e
 * `libras=1` para já abrir com o avatar ligado. Com `retorno` (endereço que recebe
 * o retorno, como `/v1/feedback` de um servidor do AutoLibras), aparecem os botões
 * "Entendi" e "Não entendi".
 */
import { attachClosedSigning } from "./closed-signing-bundle";
import { SIGN_PACK_URL } from "./lib/avatar";
import { renderSiteFooter, renderSiteNav } from "./lib/site";
import "./app.css";
import "./assista.css";

document.querySelector(".brand")?.after(renderSiteNav("videos"));
document.querySelector("main")?.after(renderSiteFooter());

const params = new URLSearchParams(location.search);
const video = document.getElementById("video") as HTMLVideoElement;
const status = document.getElementById("status") as HTMLElement;
const form = document.getElementById("form") as HTMLFormElement;
const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;

const videoUrl = params.get("video")?.trim() ?? "";
const captionsUrl = params.get("legendas")?.trim() ?? "";
const signs = params.get("signs")?.trim() || SIGN_PACK_URL;
field("video").value = videoUrl;
field("legendas").value = captionsUrl;
field("signs").value = params.get("signs") ?? "";
field("signs").placeholder = SIGN_PACK_URL || "https://…/BR/ (pasta com manifest.json)";

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const next = new URLSearchParams();
  for (const name of ["video", "legendas", "signs"]) {
    const value = field(name).value.trim();
    if (value) next.set(name, value);
  }
  next.set("libras", "1");
  location.search = next.toString();
});

async function load(): Promise<void> {
  if (!videoUrl) {
    // Sem vídeo, o player vazio só confunde: fica a explicação e o formulário.
    document.querySelector<HTMLElement>(".player")?.setAttribute("hidden", "");
    document.querySelector<HTMLElement>(".bar")?.setAttribute("hidden", "");
    document.getElementById("intro")?.removeAttribute("hidden");
    field("video").focus();
    return;
  }
  if (captionsUrl) {
    const track = document.createElement("track");
    Object.assign(track, {
      kind: "subtitles",
      srclang: "pt",
      label: "Português",
      src: captionsUrl,
    });
    video.append(track);
  }
  if (/\.m3u8($|\?)/.test(videoUrl) && !video.canPlayType("application/vnd.apple.mpegurl")) {
    const { default: Hls } = await import("hls.js");
    const hls = new Hls();
    // Carrega a legenda sem mostrá-la: o avatar a acompanha mesmo escondida.
    hls.subtitleDisplay = false;
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      // As legendas do HLS viram faixas do <video>, que o avatar acompanha.
      const index = hls.subtitleTracks.findIndex((t) => t.lang?.toLowerCase().startsWith("pt"));
      hls.subtitleTrack = Math.max(index, 0);
    });
    hls.loadSource(videoUrl);
    hls.attachMedia(video);
  } else {
    video.src = videoUrl;
  }

  if (!signs) {
    status.textContent = "Falta o pacote de sinais do avatar (parâmetro signs).";
    return;
  }
  const feedbackUrl = params.get("retorno")?.trim() || undefined;
  const libras = attachClosedSigning(video, { signs, feedbackUrl });
  document.getElementById("button-slot")?.append(libras.createButton());
  if (feedbackUrl) document.getElementById("button-slot")?.append(libras.createFeedbackButtons());
  libras.on("toggle", (on) => {
    status.textContent = on ? "Carregando o avatar…" : "";
  });
  libras.on("sentence", (sentence) => {
    status.textContent = `Sinalizando: ${sentence}`;
  });
  libras.on("error", (error) => {
    status.textContent = `Erro: ${error.message}`;
  });
  if (params.get("libras") === "1") await libras.enable();
  if (libras.enabled && status.textContent === "Carregando o avatar…") status.textContent = "";
}

void load();
