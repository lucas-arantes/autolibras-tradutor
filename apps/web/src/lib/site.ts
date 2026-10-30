/** Navegação e rodapé comuns às páginas do site. Os endereços são relativos, para
 * funcionar na raiz e no subcaminho do GitHub Pages. */

export type SitePage = "tradutor" | "transmissoes" | "videos" | "como-usar";

export const SITE_LINKS: ReadonlyArray<{ page: SitePage | "codigo"; href: string; label: string }> =
  [
    { page: "tradutor", href: "./", label: "Tradutor" },
    { page: "transmissoes", href: "./studio.html", label: "Transmissões" },
    { page: "videos", href: "./assista.html", label: "Vídeos com Libras" },
    { page: "como-usar", href: "./como-usar.html", label: "Como usar" },
    {
      page: "codigo",
      href: "https://github.com/lucas-arantes/autolibras-tradutor",
      label: "Código",
    },
  ];

export const FOOTER_TEXT =
  "Código aberto, licença MIT. A tradução automática ajuda na acessibilidade, mas não substitui intérpretes de Libras.";

/** Versão sem Svelte, para as páginas em TypeScript puro. */
export function renderSiteNav(current: SitePage): HTMLElement {
  const nav = document.createElement("nav");
  nav.className = "site-nav";
  nav.setAttribute("aria-label", "Páginas do AutoLibras");
  for (const link of SITE_LINKS) {
    const a = document.createElement("a");
    a.href = link.href;
    a.textContent = link.label;
    if (link.page === current) a.setAttribute("aria-current", "page");
    nav.append(a);
  }
  return nav;
}

export function renderSiteFooter(): HTMLElement {
  const footer = document.createElement("footer");
  footer.className = "site-footer";
  footer.textContent = FOOTER_TEXT;
  return footer;
}
