<script lang="ts">
import type { VLibrasAvatar } from "@autolibras/vlibras";
import { type AvatarKind, SIGN_PACK_URL } from "../lib/avatar";
import type { RecognizerMode, Settings, TranslatorMode } from "../lib/settings";

let { settings, onChange }: { settings: Settings; onChange: (changes: Partial<Settings>) => void } =
  $props();

const recognizers: Array<{ value: RecognizerMode; label: string; hint: string }> = [
  {
    value: "web-speech",
    label: "Navegador",
    hint: "Sem instalar nada. No Chrome, o áudio é processado pelo Google.",
  },
  {
    value: "whisper",
    label: "Servidor Whisper",
    hint: "O áudio vai só para o servidor indicado, que pode rodar no seu computador.",
  },
];

const translators: Array<{ value: TranslatorMode; label: string; hint: string }> = [
  { value: "vlibras", label: "VLibras", hint: "Melhor qualidade; usa regras locais se falhar." },
  { value: "regras", label: "Regras locais", hint: "Funciona sem enviar texto a servidores." },
];

const avatarKinds: Array<{ value: AvatarKind; label: string; hint: string }> = [
  {
    value: "vlibras",
    label: "VLibras",
    hint: "Player do governo. Os termos dele não permitem uso em vídeos e transmissões.",
  },
  {
    value: "propio",
    label: "Avatar próprio",
    hint: "Avatar aberto do AutoLibras, desenhado aqui mesmo. Precisa do pacote de sinais.",
  },
];

const avatars: Array<{ value: VLibrasAvatar; label: string }> = [
  { value: "icaro", label: "Ícaro" },
  { value: "hosana", label: "Hosana" },
  { value: "guga", label: "Guga" },
];
</script>

<section class="card settings" aria-label="Configurações">
  <h2>Configurações</h2>

  <fieldset>
    <legend>Reconhecimento de fala</legend>
    {#each recognizers as option (option.value)}
      <label class="choice">
        <input
          type="radio"
          name="recognizer"
          value={option.value}
          checked={settings.recognizer === option.value}
          onchange={() => onChange({ recognizer: option.value })}
        />
        <span>
          <strong>{option.label}</strong>
          <small>{option.hint}</small>
        </span>
      </label>
    {/each}
    {#if settings.recognizer === "whisper"}
      <label class="field url">
        <span>Endereço do servidor</span>
        <input
          type="url"
          value={settings.whisperUrl}
          spellcheck="false"
          onchange={(event) => onChange({ whisperUrl: event.currentTarget.value.trim() })}
        />
        <small>
          Se o servidor roda neste computador, o Chrome pede permissão para o site acessar serviços
          do dispositivo. É preciso permitir.
        </small>
      </label>
    {/if}
  </fieldset>

  <fieldset>
    <legend>Tradutor de glosa</legend>
    {#each translators as option (option.value)}
      <label class="choice">
        <input
          type="radio"
          name="translator"
          value={option.value}
          checked={settings.translator === option.value}
          onchange={() => onChange({ translator: option.value })}
        />
        <span>
          <strong>{option.label}</strong>
          <small>{option.hint}</small>
        </span>
      </label>
    {/each}
  </fieldset>

  <fieldset>
    <legend>Avatar</legend>
    {#each avatarKinds as option (option.value)}
      <label class="choice">
        <input
          type="radio"
          name="avatarKind"
          value={option.value}
          checked={settings.avatarKind === option.value}
          onchange={() => onChange({ avatarKind: option.value })}
        />
        <span>
          <strong>{option.label}</strong>
          <small>{option.hint}</small>
        </span>
      </label>
    {/each}
    {#if settings.avatarKind === "vlibras"}
      <label class="field url">
        <span>Personagem</span>
        <select
          value={settings.avatar}
          onchange={(event) => onChange({ avatar: event.currentTarget.value as VLibrasAvatar })}
        >
          {#each avatars as avatar (avatar.value)}
            <option value={avatar.value}>{avatar.label}</option>
          {/each}
        </select>
      </label>
    {:else}
      <label class="field url">
        <span>Pacote de sinais (URL)</span>
        <input
          type="url"
          value={settings.signsUrl}
          placeholder={SIGN_PACK_URL || "https://…/BR/"}
          spellcheck="false"
          onchange={(event) => onChange({ signsUrl: event.currentTarget.value.trim() })}
        />
        <small>
          {#if SIGN_PACK_URL}
            Vazio usa o pacote padrão deste site.
          {:else}
            Pasta com o <code>manifest.json</code> do pacote. Sem ela, o app continua com o VLibras.
          {/if}
        </small>
      </label>
    {/if}
  </fieldset>

  <label class="field">
    <span>Velocidade base: {settings.baseSpeed.toFixed(2)}×</span>
    <input
      type="range"
      min="0.5"
      max="2"
      step="0.25"
      value={settings.baseSpeed}
      oninput={(event) => onChange({ baseSpeed: Number(event.currentTarget.value) })}
    />
  </label>

  <label class="field">
    <span>Atraso máximo: {settings.maxLagSeconds} s</span>
    <input
      type="range"
      min="6"
      max="40"
      step="1"
      value={settings.maxLagSeconds}
      oninput={(event) => onChange({ maxLagSeconds: Number(event.currentTarget.value) })}
    />
    <small>Acima disso, frases antigas são descartadas para acompanhar a fala.</small>
  </label>
</section>

<style>
  fieldset {
    border: 0;
    padding: 0;
    margin: 0 0 1rem;
    display: grid;
    gap: 0.5rem;
  }

  legend,
  .field > span {
    font-weight: 600;
    margin-bottom: 0.4rem;
    color: var(--text-strong);
  }

  .choice {
    display: flex;
    gap: 0.6rem;
    align-items: start;
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .choice:has(input:checked) {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .choice input {
    margin-top: 0.2rem;
    accent-color: var(--accent);
  }

  .choice span {
    display: grid;
  }

  small {
    color: var(--text-muted);
    font-size: 0.8rem;
  }

  .field {
    display: grid;
    gap: 0.35rem;
    margin-bottom: 1rem;
  }

  .field:last-child {
    margin-bottom: 0;
  }

  .url {
    margin: 0.25rem 0 0;
  }

  .url input {
    padding: 0.5rem 0.65rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 0.85rem;
  }

  input[type="range"] {
    width: 100%;
    accent-color: var(--accent);
  }
</style>
