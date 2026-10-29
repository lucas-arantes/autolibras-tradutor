<script lang="ts">
import type { Entry } from "../lib/controller.svelte";

let { entries, onClear }: { entries: Entry[]; onClear: () => void } = $props();

const SOURCE_LABELS: Record<string, string> = { vlibras: "VLibras", regras: "Regras locais" };
</script>

<section class="card history" aria-label="Histórico">
  <div class="card-head">
    <h2>Histórico</h2>
    {#if entries.length > 0}
      <button type="button" class="link" onclick={onClear}>Limpar</button>
    {/if}
  </div>

  {#if entries.length === 0}
    <p class="empty">Nenhuma frase traduzida ainda.</p>
  {:else}
    <ol>
      {#each entries as entry (entry.id)}
        <li data-status={entry.status}>
          <div class="entry-top">
            <p class="text">{entry.text}</p>
            <span class="badge" data-status={entry.status}>{entry.status}</span>
          </div>
          {#if entry.gloss}
            <p class="gloss">
              <code>{entry.gloss}</code>
              {#if entry.source}
                <span class="source">{SOURCE_LABELS[entry.source] ?? entry.source}</span>
              {/if}
            </p>
          {:else if entry.error}
            <p class="error">{entry.error}</p>
          {/if}
        </li>
      {/each}
    </ol>
  {/if}
</section>

<style>
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.5rem;
  }

  li {
    padding: 0.75rem;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    border-left: 4px solid var(--border);
  }

  li[data-status="sinalizando"] {
    border-left-color: var(--accent);
  }

  li[data-status="descartado"],
  li[data-status="erro"] {
    opacity: 0.7;
  }

  .entry-top {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    align-items: start;
  }

  .text {
    margin: 0;
    font-size: 1.05rem;
  }

  .gloss {
    margin: 0.4rem 0 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }

  code {
    font-family: var(--font-mono);
    font-size: 0.9rem;
    color: var(--text-strong);
    word-break: break-word;
  }

  .source {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .error {
    margin: 0.4rem 0 0;
    color: var(--danger);
    font-size: 0.9rem;
  }

  .empty {
    margin: 0;
    color: var(--text-muted);
  }
</style>
