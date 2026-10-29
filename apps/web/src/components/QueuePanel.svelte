<script lang="ts">
import type { AvatarStatus } from "../lib/controller.svelte";

let {
  lagSeconds,
  maxLagSeconds,
  speed,
  pending,
  dropped,
  avatarStatus,
  onClear,
  onRetry,
}: {
  lagSeconds: number;
  maxLagSeconds: number;
  speed: number;
  pending: number;
  dropped: number;
  avatarStatus: AvatarStatus;
  onClear: () => void;
  onRetry: () => void;
} = $props();

const fill = $derived(Math.min(100, (lagSeconds / maxLagSeconds) * 100));
const level = $derived(fill > 75 ? "high" : fill > 40 ? "medium" : "low");
</script>

<section class="card queue" aria-label="Fila do avatar">
  <div class="card-head">
    <h2>Avatar</h2>
    {#if pending > 0}
      <button type="button" class="link" onclick={onClear}>Limpar fila</button>
    {/if}
  </div>

  {#if avatarStatus === "carregando"}
    <p class="muted">Carregando o avatar do VLibras… (pode levar alguns segundos)</p>
  {:else if avatarStatus === "erro"}
    <p class="muted">
      Não foi possível carregar o avatar.
      <button type="button" class="link" onclick={onRetry}>Tentar de novo</button>
    </p>
  {:else}
    <p class="muted">O avatar aparece na janela do VLibras, no canto da tela.</p>
  {/if}

  <div
    class="meter"
    role="meter"
    aria-label="Atraso da sinalização"
    aria-valuemin="0"
    aria-valuemax={maxLagSeconds}
    aria-valuenow={Math.round(lagSeconds)}
  >
    <div class="meter-fill" data-level={level} style:width="{fill}%"></div>
  </div>

  <dl>
    <div>
      <dt>Atraso</dt>
      <dd>≈ {lagSeconds.toFixed(1)} s</dd>
    </div>
    <div>
      <dt>Velocidade</dt>
      <dd>{speed.toFixed(2)}×</dd>
    </div>
    <div>
      <dt>Na fila</dt>
      <dd>{pending}</dd>
    </div>
    <div>
      <dt>Descartadas</dt>
      <dd>{dropped}</dd>
    </div>
  </dl>
</section>

<style>
  .muted {
    margin: 0 0 0.75rem;
    color: var(--text-muted);
    font-size: 0.9rem;
  }

  .meter {
    height: 8px;
    border-radius: 999px;
    background: var(--surface-2);
    overflow: hidden;
  }

  .meter-fill {
    height: 100%;
    background: var(--success);
    transition: width 0.3s ease;
  }

  .meter-fill[data-level="medium"] {
    background: var(--warning);
  }

  .meter-fill[data-level="high"] {
    background: var(--danger);
  }

  dl {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.75rem;
    margin: 1rem 0 0;
  }

  dt {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  dd {
    margin: 0.15rem 0 0;
    font-size: 1.25rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--text-strong);
  }
</style>
