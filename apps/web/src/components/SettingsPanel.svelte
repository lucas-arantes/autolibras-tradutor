<script lang="ts">
import type { VLibrasAvatar } from "@autolibras/vlibras";
import type { Settings, TranslatorMode } from "../lib/settings";

let { settings, onChange }: { settings: Settings; onChange: (changes: Partial<Settings>) => void } =
  $props();

const translators: Array<{ value: TranslatorMode; label: string; hint: string }> = [
  { value: "vlibras", label: "VLibras", hint: "Melhor qualidade; usa regras locais se falhar." },
  { value: "regras", label: "Regras locais", hint: "Funciona sem enviar texto a servidores." },
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

  <label class="field">
    <span>Avatar</span>
    <select
      value={settings.avatar}
      onchange={(event) => onChange({ avatar: event.currentTarget.value as VLibrasAvatar })}
    >
      {#each avatars as avatar (avatar.value)}
        <option value={avatar.value}>{avatar.label}</option>
      {/each}
    </select>
  </label>

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

  input[type="range"] {
    width: 100%;
    accent-color: var(--accent);
  }
</style>
