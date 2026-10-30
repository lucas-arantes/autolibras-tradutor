<script lang="ts">
import { captureStream, RemoteWhisperRecognizer } from "@autolibras/stt-web";
import { onDestroy } from "svelte";
import {
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
let typed = $state("");
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

async function checkServer(): Promise<void> {
  error = null;
  try {
    health = await api.health();
  } catch (e) {
    health = null;
    error = e instanceof Error ? e.message : String(e);
  }
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
  } catch {
    // A próxima consulta tenta de novo.
  }
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

checkServer();
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
          <button type="button" class="secondary" onclick={checkServer}>Testar</button>
        </div>
      </label>
      {#if health?.tokenRequired || settings.token}
        <label class="field">
          <span>Token de acesso</span>
          <input type="password" bind:value={settings.token} disabled={running} />
        </label>
      {/if}
    </div>
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
          Modo sincronizado: o vídeo da transmissão está atrasado em
          <input
            type="number"
            min="1"
            max="60"
            class="seconds"
            bind:value={settings.syncDelay}
            disabled={settings.syncDelay <= 0}
            aria-label="Atraso do vídeo, em segundos"
          />
          segundos
        </label>
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

  <section class="card notice">
    <p>
      O avatar automático complementa, mas não substitui, o intérprete de Libras. Na TV, a lei exige
      a janela com intérprete.
    </p>
  </section>
</main>

<style>
  .studio {
    display: grid;
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
