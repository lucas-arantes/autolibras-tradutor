<script lang="ts">
import { captureStream, RemoteWhisperRecognizer } from "@autolibras/stt-web";
import { onDestroy } from "svelte";
import SiteFooter from "./components/SiteFooter.svelte";
import SiteNav from "./components/SiteNav.svelte";
import {
  type FeedbackList,
  feedbackPageUrl,
  ingestUrl,
  newSessionId,
  overlayUrl,
  type ServerHealth,
  SessionApi,
  type SessionInfo,
  type StudioAvatar,
  type StudioSettings,
  saveStudioSettings,
  signPackFor,
  textUrl,
} from "./lib/studio";

let { initial, pageBase }: { initial: StudioSettings; pageBase: string } = $props();

// Só o valor inicial: daqui em diante a página é dona das configurações.
// svelte-ignore state_referenced_locally
let settings = $state<StudioSettings>({ ...initial });
let health = $state<ServerHealth | null>(null);
let session = $state<SessionInfo | null>(null);
let running = $state(false);
let busy = $state(false);
let error = $state<string | null>(null);
let transcript = $state("");
let devices = $state<MediaDeviceInfo[]>([]);
let copied = $state(false);
let checked = $state(false);
let typed = $state("");
let feedback = $state<FeedbackList | null>(null);
let feedbackCopied = $state(false);
// A chave fica guardada depois de parar, para o link continuar valendo na próxima live.
let feedbackKey = $state("");
// Endereço e chave para o OBS (fonte RTMP); só vêm na resposta de criação da sessão.
let rtmpTarget = $state<{ server: string; key: string } | null>(null);
let rtmpCopied = $state("");
let sentTexts = $state<string[]>([]);

let recognizer: RemoteWhisperRecognizer | undefined;
let poll: ReturnType<typeof setInterval> | undefined;

const avatars: Array<{ value: StudioAvatar; label: string }> = [
  { value: "propio", label: "Avatar próprio" },
  { value: "icaro", label: "VLibras: Ícaro" },
  { value: "hosana", label: "VLibras: Hosana" },
  { value: "guga", label: "VLibras: Guga" },
];

const api = $derived(new SessionApi(settings.server.trim(), settings.token.trim()));
const overlay = $derived(overlayUrl(settings, pageBase, health));
const signPack = $derived(signPackFor(settings, health));
const ownAvatar = $derived(settings.avatar === "propio");

$effect(() => saveStudioSettings($state.snapshot(settings)));

/** `quiet`: na abertura da página, a falta de servidor vira uma explicação, não um erro. */
async function checkServer(quiet = false): Promise<void> {
  error = null;
  try {
    health = await api.health();
  } catch (e) {
    health = null;
    if (!quiet) error = e instanceof Error ? e.message : String(e);
  }
  checked = true;
}

async function listDevices(): Promise<void> {
  error = null;
  try {
    // Os nomes dos dispositivos só aparecem depois da permissão de microfone.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    const all = await navigator.mediaDevices.enumerateDevices();
    devices = all.filter((device) => device.kind === "audioinput");
  } catch (e) {
    error = `Não foi possível listar os dispositivos: ${e instanceof Error ? e.message : e}`;
  }
}

async function start(): Promise<void> {
  if (busy || running) return;
  busy = true;
  error = null;
  transcript = "";
  try {
    health = await api.health();
    session = await api.create($state.snapshot(settings));
    feedbackKey = session.feedbackKey;
    rtmpTarget = session.rtmp ?? null;
    if (settings.source === "audio") startAudio();
    running = true;
    poll = setInterval(refresh, 3_000);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    busy = false;
  }
}

function startAudio(): void {
  const deviceId = settings.deviceId;
  recognizer = new RemoteWhisperRecognizer({
    url: ingestUrl(settings.server.trim(), settings.sessionId, settings.token.trim()),
    captureAudio: async (onSamples) => {
      // Sem cancelamento de eco nem supressão de ruído: numa mesa de som ou placa
      // de captura, eles mais atrapalham do que ajudam o reconhecimento.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      return captureStream(stream)(onSamples);
    },
  });
  recognizer.on("transcript", (segment) => {
    transcript = segment.text || transcript;
  });
  recognizer.on("error", (e) => {
    error = e.message;
  });
  recognizer.start();
}

async function refresh(): Promise<void> {
  try {
    session = await api.get(settings.sessionId);
    feedbackKey = session.feedbackKey;
    feedback = await api.feedback(session.feedbackKey);
  } catch {
    // A próxima consulta tenta de novo.
  }
}

const feedbackLink = $derived(
  feedbackKey ? feedbackPageUrl(settings.server, feedbackKey, pageBase, health?.web ?? false) : "",
);

async function copyFeedbackLink(): Promise<void> {
  await navigator.clipboard.writeText(feedbackLink);
  feedbackCopied = true;
  setTimeout(() => (feedbackCopied = false), 2_000);
}

async function stop(): Promise<void> {
  busy = true;
  clearInterval(poll);
  recognizer?.stop();
  recognizer = undefined;
  try {
    await api.delete(settings.sessionId);
  } catch {
    // A sessão já tinha acabado ou o servidor caiu: nada a desfazer.
  } finally {
    running = false;
    busy = false;
    session = null;
  }
}

async function sendText(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const text = typed.trim();
  if (!text) return;
  try {
    await api.text(settings.sessionId, text);
    sentTexts = [text, ...sentTexts].slice(0, 5);
    typed = "";
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
}

function useRecommendedDelay(): void {
  if (session?.latency) settings.syncDelay = session.latency.recommendedDelay;
}

async function copyText(label: string, text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
  rtmpCopied = label;
  setTimeout(() => (rtmpCopied = ""), 2_000);
}

const compositionStateLabel: Record<string, string> = {
  starting: "esperando a transmissão",
  live: "ao vivo",
  ended: "encerrada",
};

async function copy(): Promise<void> {
  await navigator.clipboard.writeText(overlay);
  copied = true;
  setTimeout(() => (copied = false), 2_000);
}

function newId(): void {
  if (confirm("A URL do overlay vai mudar e será preciso colar a nova no OBS. Continuar?")) {
    settings.sessionId = newSessionId();
  }
}

const stateLabel: Record<SessionInfo["state"], string> = {
  waiting: "esperando áudio",
  live: "ao vivo",
  ended: "encerrada",
  error: "erro",
};

checkServer(true);
onDestroy(() => {
  clearInterval(poll);
  recognizer?.stop();
});
</script>

<header class="topbar">
  <div class="topbar-inner">
    <div class="brand">
      <img src="icon.svg" alt="" width="36" height="36" />
      <div>
        <h1>AutoLibras Estúdio</h1>
        <p>Libras automática na sua transmissão, pelo OBS</p>
      </div>
    </div>
    <SiteNav current="transmissoes" />
    <div class="pills" aria-label="Estado">
      <span class="pill" data-state={health ? "pronto" : "erro"}>
        Servidor: {health ? `pronto (${health.model})` : "sem conexão"}
      </span>
      {#if session}
        <span class="pill" data-state={session.state === "live" ? "listening" : session.state}>
          Sessão: {stateLabel[session.state]}
        </span>
        <span class="pill">Overlays conectados: {session.subscribers}</span>
      {/if}
    </div>
  </div>
</header>

<main class="studio">
  {#if error}
    <div class="alert" role="alert">
      <span>{error}</span>
      <button type="button" class="link" onclick={() => (error = null)}>Fechar</button>
    </div>
  {/if}

  <section class="card">
    <h2>1. Servidor</h2>
    <div class="fields">
      <label class="field">
        <span>Endereço</span>
        <div class="row">
          <input type="url" bind:value={settings.server} spellcheck="false" disabled={running} />
          <button type="button" class="secondary" onclick={() => checkServer()}>Testar</button>
        </div>
      </label>
      {#if health?.tokenRequired || settings.token}
        <label class="field">
          <span>Token de acesso</span>
          <input type="password" bind:value={settings.token} disabled={running} />
        </label>
      {/if}
    </div>
    {#if checked && !health}
      <p class="muted server-missing">
        Nenhum servidor do AutoLibras respondeu em {settings.server}. Para transmitir, suba o servidor
        no seu computador com o Docker, seguindo o
        <a href="https://github.com/lucas-arantes/autolibras-tradutor/blob/main/docs/transmissoes-obs.md">
          guia do OBS</a
        >, e clique em Testar.
      </p>
    {/if}
  </section>

  <section class="card">
    <h2>2. Fonte da tradução</h2>
    <fieldset disabled={running}>
      <label class="choice">
        <input type="radio" bind:group={settings.source} value="audio" />
        <span>
          <strong>Dispositivo de áudio deste computador</strong>
          <small>Microfone, mesa de som, placa de captura ou cabo virtual com o som da live.</small>
        </span>
      </label>
      {#if settings.source === "audio"}
        <div class="row indent">
          <select bind:value={settings.deviceId} aria-label="Dispositivo de áudio">
            <option value="">Padrão do sistema</option>
            {#each devices as device (device.deviceId)}
              <option value={device.deviceId}>{device.label || "Dispositivo sem nome"}</option>
            {/each}
          </select>
          <button type="button" class="secondary" onclick={listDevices}>Listar dispositivos</button>
        </div>
      {/if}
      <label class="choice">
        <input type="radio" bind:group={settings.source} value="url" />
        <span>
          <strong>Endereço da transmissão</strong>
          <small>
            O servidor lê o áudio com o ffmpeg: rtmp://, srt://, ou um .m3u8 (HLS). Esta página pode
            ser fechada depois de iniciar.
          </small>
        </span>
      </label>
      {#if settings.source === "url"}
        <div class="indent fields">
          <input
            type="url"
            bind:value={settings.streamUrl}
            placeholder="rtmp://servidor/live/chave ou https://…/index.m3u8"
            spellcheck="false"
            aria-label="Endereço da transmissão"
          />
          <label class="check">
            <input type="checkbox" bind:checked={settings.realtime} />
            É um vídeo gravado (ler na velocidade normal, como se fosse ao vivo)
          </label>
          <label class="check">
            <input type="checkbox" bind:checked={settings.captions} />
            Usar a legenda da transmissão (WebVTT do HLS ou closed caption) em vez de reconhecer a fala
          </label>
        </div>
      {/if}
      <label class="choice">
        <input type="radio" bind:group={settings.source} value="rtmp" />
        <span>
          <strong>Transmissão enviada pelo OBS (RTMP)</strong>
          <small>
            O OBS transmite para o servidor do AutoLibras em vez de ir direto para a plataforma. Com a
            janela de Libras no vídeo (seção 4), o servidor repassa a live já com a janela.
          </small>
        </span>
      </label>
      <label class="choice">
        <input type="radio" bind:group={settings.source} value="text" />
        <span>
          <strong>Texto</strong>
          <small>
            Digitado aqui ou enviado por outro programa, como um sistema de legendas ou de
            estenotipia.
          </small>
        </span>
      </label>
    </fieldset>
    <div class="actions">
      {#if running}
        <button type="button" class="mic-button active" onclick={stop} disabled={busy}>Parar</button>
      {:else}
        <button
          type="button"
          class="mic-button"
          onclick={start}
          disabled={busy || (settings.source === "url" && !settings.streamUrl.trim())}
        >
          Iniciar tradução
        </button>
      {/if}
    </div>
    {#if running && settings.source === "audio"}
      <p class="caption partial" aria-live="polite">
        {transcript || "A transcrição aparece aqui quando alguém falar."}
      </p>
    {/if}
    {#if running && settings.source === "rtmp" && rtmpTarget}
      <div class="fields obs-target">
        <p class="muted">
          No OBS, em <em>Configurações → Transmissão</em>, escolha o serviço <em>Personalizado</em> e
          use:
        </p>
        <div class="row">
          <input type="text" readonly value={rtmpTarget.server} aria-label="Servidor RTMP para o OBS" />
          <button type="button" class="secondary" onclick={() => copyText("servidor", rtmpTarget?.server ?? "")}>
            {rtmpCopied === "servidor" ? "Copiado" : "Copiar servidor"}
          </button>
        </div>
        <div class="row">
          <input type="password" readonly value={rtmpTarget.key} aria-label="Chave de transmissão para o OBS" />
          <button type="button" class="secondary" onclick={() => copyText("chave", rtmpTarget?.key ?? "")}>
            {rtmpCopied === "chave" ? "Copiado" : "Copiar chave"}
          </button>
        </div>
      </div>
    {/if}
    {#if running && settings.source === "text"}
      <form class="fields text-form" onsubmit={sendText}>
        <div class="row">
          <input type="text" bind:value={typed} aria-label="Texto para traduzir" />
          <button type="submit" class="secondary" disabled={!typed.trim()}>Enviar</button>
        </div>
        {#each sentTexts as text, index (index)}
          <small class="muted">Enviado: {text}</small>
        {/each}
        <small class="muted">
          Para outro programa enviar o texto: POST em <code>{textUrl(settings.server, settings.sessionId)}</code>
          com <code>{'{"text": "..."}'}</code>{settings.token ? " e o token no cabeçalho Authorization" : ""}.
        </small>
      </form>
    {/if}
  </section>

  <section class="card">
    <h2>3. Overlay no OBS</h2>
    <div class="fields">
      <div class="row">
        <input type="text" readonly value={overlay} aria-label="Endereço do overlay" />
        <button type="button" class="secondary" onclick={copy}>{copied ? "Copiado" : "Copiar"}</button>
      </div>
      <div class="row wrap">
        <label class="check">
          Avatar
          <select bind:value={settings.avatar}>
            {#each avatars as avatar (avatar.value)}
              <option value={avatar.value}>{avatar.label}</option>
            {/each}
          </select>
        </label>
        <label class="check">
          <input type="checkbox" bind:checked={settings.caption} />
          Mostrar a frase sob o avatar
        </label>
        <a href={`${overlay}&status=1`} target="_blank" rel="noopener">Abrir prévia</a>
      </div>
      {#if ownAvatar}
        <label class="field">
          <span>Pacote de sinais</span>
          <input
            type="url"
            bind:value={settings.signsUrl}
            placeholder={signPack || "https://…/BR/ (pasta com manifest.json)"}
            spellcheck="false"
          />
          <small class="muted">
            {#if !signPack}
              Nenhum pacote encontrado. Indique o endereço de um pacote publicado ou monte o seu e
              aponte AUTOLIBRAS_SIGNS_DIR para ele no servidor.
            {:else if !settings.signsUrl.trim()}
              Em branco, usa {health?.signs ? "o pacote do servidor" : "o pacote padrão"}.
            {/if}
          </small>
        </label>
      {:else}
        <p class="muted">
          Os termos de uso do VLibras não autorizam tradução automática em produções audiovisuais.
          Use o avatar do VLibras só para testes.
        </p>
      {/if}
      <div class="sync">
        <label class="check">
          <input
            type="checkbox"
            checked={settings.syncDelay > 0}
            onchange={(event) => {
              settings.syncDelay = event.currentTarget.checked
                ? (session?.latency?.recommendedDelay ?? 8)
                : 0;
            }}
          />
          Modo sincronizado
        </label>
        {#if settings.syncDelay > 0}
          <label class="check indent">
            O vídeo da transmissão está atrasado em
            <input
              type="number"
              min="1"
              max="60"
              class="seconds"
              bind:value={settings.syncDelay}
              aria-label="Atraso do vídeo, em segundos"
            />
            segundos
          </label>
        {/if}
        {#if session?.latency}
          <small class="muted">
            Nesta sessão, metade das frases ficou pronta em {session.latency.p50} s e 95% em até
            {session.latency.p95} s, contando do começo da fala. Atraso sugerido:
            {session.latency.recommendedDelay} s.
            {#if settings.syncDelay > 0 && settings.syncDelay !== session.latency.recommendedDelay}
              <button type="button" class="link" onclick={useRecommendedDelay}>Usar o sugerido</button>
            {/if}
          </small>
        {/if}
        <small class="muted">
          No modo sincronizado, cada frase começa no tempo exato da fala no vídeo atrasado. O atraso
          precisa ser aplicado ao vídeo e ao áudio da transmissão, mas não ao overlay, no sistema
          de produção. O OBS sozinho não tem um jeito simples de fazer isso por vários segundos.
          Sem esse atraso, deixe o modo desligado.
        </small>
      </div>
      <ol class="steps">
        <li>No OBS, em <em>Fontes</em>, clique em <strong>+</strong> e escolha <em>Navegador</em>.</li>
        <li>
          Cole o endereço acima em <em>URL</em>.
          {ownAvatar ? "Use largura 400 e altura 600." : "Use largura 260 e altura 380."}
        </li>
        <li>Arraste a fonte para um canto da cena e amplie pelas bordas, se quiser.</li>
      </ol>
      <p class="muted">
        O endereço não muda entre uma live e outra: configure o OBS uma vez.
        <button type="button" class="link" onclick={newId} disabled={running}>Gerar outro endereço</button>
      </p>
    </div>
  </section>

  <section class="card">
    <h2>4. Janela de Libras no vídeo (opcional)</h2>
    {#if health && !health.composition}
      <p class="muted">
        Este servidor não junta a janela de Libras ao vídeo: {health.compositionError ??
          "recurso indisponível"}.
      </p>
    {:else}
      <fieldset class="fields" disabled={running}>
        <p class="muted">
          Em vez do overlay no OBS, o servidor pode devolver a transmissão já com a janela de Libras,
          atrasada para o sinal sair junto com a fala, e enviá-la à plataforma. Funciona com as fontes
          "Endereço da transmissão" e "Transmissão enviada pelo OBS".
        </p>
        <label class="check">
          <input type="checkbox" bind:checked={settings.composition.enabled} />
          Enviar a transmissão com a janela de Libras
        </label>
        {#if settings.composition.enabled}
          <label class="field">
            <span>Para onde enviar (servidor e chave da plataforma)</span>
            <input
              type="password"
              bind:value={settings.composition.output}
              placeholder="rtmp://a.rtmp.youtube.com/live2/sua-chave"
              spellcheck="false"
              autocomplete="off"
            />
            <small class="muted">
              Junte o endereço do servidor e a chave de transmissão da plataforma (YouTube, Twitch ou
              outro RTMP ou SRT), separados por "/".
            </small>
          </label>
          <div class="row wrap">
            <label class="check">
              Atraso
              <input type="number" min="2" max="30" class="seconds" bind:value={settings.composition.delay} />
              segundos
            </label>
            <label class="check">
              Lado
              <select bind:value={settings.composition.position}>
                <option value="right">Direita</option>
                <option value="left">Esquerda</option>
              </select>
            </label>
            <label class="check">
              Altura
              <select bind:value={settings.composition.size}>
                <option value={0.3}>30%</option>
                <option value={0.4}>40%</option>
                <option value={0.5}>50%</option>
                <option value={0.6}>60%</option>
              </select>
            </label>
            <label class="check">
              Fundo
              <select bind:value={settings.composition.background}>
                <option value="painel">Painel</option>
                <option value="recorte">Só o avatar</option>
              </select>
            </label>
            <label class="check">
              Resolução
              <select bind:value={settings.composition.resolution}>
                <option value="1280x720">720p</option>
                <option value="1920x1080">1080p</option>
              </select>
            </label>
            <label class="check">
              <input type="checkbox" bind:checked={settings.composition.caption} />
              Frase na janela
            </label>
          </div>
          <small class="muted">
            O atraso precisa cobrir o tempo que a fala leva para virar sinal; com o servidor em CPU,
            comece com 8 segundos. A plataforma recebe a live esse tanto mais tarde.
          </small>
        {/if}
      </fieldset>
      {#if running && session?.composition}
        <p class="muted">
          Composição: {compositionStateLabel[session.composition.state] ?? session.composition.state}
          ({session.composition.frames} quadros da janela enviados).
        </p>
      {/if}
    {/if}
  </section>

  <section class="card">
    <h2>5. Retorno do público</h2>
    {#if feedbackLink}
      <div class="fields">
        <p class="muted">
          Ponha este link no chat ou na descrição da live. Quem assiste diz se entendeu a tradução, e
          as respostas aparecem aqui.
        </p>
        <div class="row">
          <input type="text" readonly value={feedbackLink} aria-label="Link do formulário de retorno" />
          <button type="button" class="secondary" onclick={copyFeedbackLink}>
            {feedbackCopied ? "Copiado" : "Copiar"}
          </button>
        </div>
        {#if feedback}
          <p>
            <strong>{feedback.summary.good}</strong> entenderam e
            <strong>{feedback.summary.bad}</strong> não entenderam.
          </p>
          <ul class="feedback-list">
            {#each feedback.items.filter((item) => item.comment).slice(0, 10) as item (item.time)}
              <li>
                <span class="badge" data-status={item.rating === "good" ? "concluído" : "erro"}>
                  {item.rating === "good" ? "Entendi" : "Não entendi"}
                </span>
                {item.comment}
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {:else}
      <p class="muted">O link para o público avaliar aparece quando a tradução começa.</p>
    {/if}
  </section>

  <section class="card notice">
    <p>
      O avatar automático complementa, mas não substitui, o intérprete de Libras. Na TV, a lei exige
      a janela com intérprete.
    </p>
  </section>
</main>
<SiteFooter />

<style>
  .studio {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1rem;
    max-width: 760px;
    margin: 0 auto;
    padding: 1rem 16px 3rem;
  }
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.6rem;
  }
  .fields {
    display: grid;
    gap: 0.75rem;
  }
  .field {
    display: grid;
    gap: 0.35rem;
  }
  .field > span {
    font-weight: 600;
    color: var(--text-strong);
  }
  .choice {
    display: flex;
    gap: 0.6rem;
    align-items: flex-start;
  }
  .choice span {
    display: grid;
  }
  .choice small,
  .muted {
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  .muted {
    margin: 0;
  }
  .indent {
    margin-left: 1.6rem;
  }
  .row.wrap {
    flex-wrap: wrap;
    gap: 0.75rem 1.25rem;
    align-items: center;
  }
  .check {
    display: inline-flex;
    gap: 0.4rem;
    align-items: center;
  }
  .actions {
    margin-top: 1rem;
  }
  .caption {
    margin-top: 1rem;
    min-height: 0;
    font-size: 1.1rem;
  }
  .feedback-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 0.4rem;
  }
  .feedback-list li {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
  }
  .sync {
    display: grid;
    gap: 0.35rem;
  }
  .seconds {
    width: 4.5rem;
    padding: 0.3rem 0.4rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
  }
  .obs-target {
    margin-top: 1rem;
  }
  .server-missing {
    margin-top: 0.75rem;
  }
  .text-form {
    margin-top: 1rem;
  }
  code {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    word-break: break-all;
  }
  .steps {
    margin: 0;
    padding-left: 1.25rem;
  }
  input[type="url"],
  input[type="password"] {
    flex: 1;
    min-width: 0;
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
  }
  .indent input[type="url"] {
    width: 100%;
  }
</style>
