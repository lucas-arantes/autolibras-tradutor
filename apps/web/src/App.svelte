<script lang="ts">
import { onMount } from "svelte";
import History from "./components/History.svelte";
import QueuePanel from "./components/QueuePanel.svelte";
import SettingsPanel from "./components/SettingsPanel.svelte";
import { TranslatorController } from "./lib/controller.svelte";

const app = new TranslatorController();
let typed = $state("");

onMount(() => {
  void app.loadAvatar();
});

const micLabel = $derived(
  app.micState === "listening" ? "Ouvindo" : app.micState === "error" ? "Erro" : "Parado",
);
const lastFinal = $derived(app.entries[0]?.text ?? "");

function onSubmit(event: SubmitEvent) {
  event.preventDefault();
  if (app.submitText(typed)) typed = "";
}
</script>

<header class="topbar">
  <div class="topbar-inner">
  <div class="brand">
    <img src="{import.meta.env.BASE_URL}icon.svg" alt="" width="36" height="36" />
    <div>
      <h1>AutoLibras Tradutor</h1>
      <p>Português falado → Libras</p>
    </div>
  </div>
  <div class="pills" aria-label="Estado">
    <span class="pill" data-state={app.micState}>Microfone: {micLabel}</span>
    <span class="pill" data-state={app.avatarStatus}>Avatar: {app.avatarStatus}</span>
  </div>
  </div>
</header>

<main class="layout">
  <section class="live" aria-label="Tradução ao vivo">
    <div class="card mic-card">
      <button
        type="button"
        class="mic-button"
        class:active={app.listening}
        aria-pressed={app.listening}
        disabled={!app.speechSupported}
        onclick={() => app.toggleListening()}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" width="28" height="28">
          {#if app.listening}
            <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
          {:else}
            <path
              fill="currentColor"
              d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"
            />
          {/if}
        </svg>
        <span>{app.listening ? "Parar" : "Começar a ouvir"}</span>
      </button>

      {#if !app.speechSupported}
        <p class="hint">
          {#if app.settings.recognizer === "whisper"}
            Este navegador não permite capturar o microfone para o servidor Whisper. Digite o texto
            abaixo.
          {:else}
            Este navegador não tem reconhecimento de fala. Use Chrome, Edge ou Safari, escolha o
            servidor Whisper nas configurações ou digite o texto abaixo.
          {/if}
        </p>
      {/if}

      <p class="caption" class:partial={app.partial} aria-live="polite">
        {#if app.partial}
          {app.partial}
        {:else if lastFinal}
          {lastFinal}
        {:else}
          <span class="placeholder">A transcrição da fala aparece aqui.</span>
        {/if}
      </p>
    </div>

    <form class="card type-form" onsubmit={onSubmit}>
      <label for="typed">Ou digite um texto em português</label>
      <div class="row">
        <input id="typed" bind:value={typed} placeholder="Ex.: Bom dia, tudo bem?" autocomplete="off" />
        <button type="submit" class="secondary" disabled={!typed.trim()}>Traduzir</button>
      </div>
    </form>

    {#if app.lastError}
      <div class="alert" role="alert">
        <span>{app.lastError}</span>
        <button type="button" class="link" onclick={() => (app.lastError = null)}>Fechar</button>
      </div>
    {/if}

    <History entries={app.entries} onClear={() => app.clearHistory()} />
  </section>

  <aside class="side" aria-label="Avatar e configurações">
    <QueuePanel
      lagSeconds={app.lagSeconds}
      maxLagSeconds={app.settings.maxLagSeconds}
      speed={app.speed}
      pending={app.pending}
      dropped={app.dropped}
      avatarStatus={app.avatarStatus}
      avatarKind={app.avatarKind}
      avatarCanvas={app.avatarCanvas}
      onClear={() => app.clearQueue()}
      onRetry={() => app.loadAvatar()}
    />
    <SettingsPanel settings={app.settings} onChange={(changes) => app.updateSettings(changes)} />
    <section class="card notice">
      <h2>Avisos</h2>
      <p>
        A tradução automática é um apoio e <strong>não substitui intérpretes de Libras</strong>.
      </p>
      <p>
        Com o reconhecimento do navegador, o Chrome envia o áudio do microfone ao Google. Com o
        servidor Whisper, o áudio vai só para o endereço configurado. Com o tradutor VLibras, o
        texto transcrito é enviado aos servidores do VLibras (governo federal).
      </p>
    </section>
  </aside>
</main>
