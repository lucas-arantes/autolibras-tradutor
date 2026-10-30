/**
 * `closed-signing.js`: o "closed signing" para qualquer site, num endereço fixo.
 *
 * ```html
 * <script type="module">
 *   import { attachClosedSigning } from "https://…/closed-signing.js";
 *   const libras = attachClosedSigning(document.querySelector("video"), {
 *     signs: "https://…/pacote-de-sinais/",
 *   });
 *   document.querySelector(".controles").append(libras.createButton());
 * </script>
 * ```
 *
 * Sem `signs`, usa o pacote de sinais definido no build do site, se houver.
 */
import {
  attachClosedSigning as attach,
  type ClosedSigning,
  type ClosedSigningOptions,
} from "@autolibras/closed-signing";
import { SIGN_PACK_URL } from "./lib/avatar";

export * from "@autolibras/closed-signing";

export function attachClosedSigning(
  video: HTMLVideoElement,
  options: Partial<ClosedSigningOptions> = {},
): ClosedSigning {
  const signs = options.signs ?? SIGN_PACK_URL;
  if (!signs) throw new Error("Informe o pacote de sinais em `signs`");
  return attach(video, { ...options, signs });
}
