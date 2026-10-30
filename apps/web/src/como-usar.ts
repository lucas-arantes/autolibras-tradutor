/** Guia técnico: conteúdo estático, com a navegação e o rodapé do site. */
import { renderSiteFooter, renderSiteNav } from "./lib/site";
import "./app.css";
import "./como-usar.css";

document.querySelector(".brand")?.after(renderSiteNav("como-usar"));
document.querySelector("main")?.after(renderSiteFooter());
