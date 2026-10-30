<script lang="ts">
import { SITE_LINKS, type SitePage } from "../lib/site";

let { current }: { current: SitePage } = $props();
</script>

<nav class="site-nav" aria-label="Páginas do AutoLibras">
  {#each SITE_LINKS as link (link.href)}
    <a href={link.href} aria-current={link.page === current ? "page" : undefined}>{link.label}</a>
  {/each}
</nav>
