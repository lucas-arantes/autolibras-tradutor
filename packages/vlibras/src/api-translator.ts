import type { GlossResult, GlossTranslator } from "@autolibras/core";

export const VLIBRAS_TRANSLATE_URL = "https://traducao2.vlibras.gov.br/translate";

export interface VLibrasApiTranslatorOptions {
  url?: string;
  fetch?: typeof fetch;
}

/**
 * Tradutor PT→glosa do VLibras, via o mesmo endpoint usado pelo Widget oficial.
 * Não há API documentada nem SLA: use com um tradutor local de reserva.
 */
export class VLibrasApiTranslator implements GlossTranslator {
  readonly name = "vlibras";
  readonly #url: string;
  readonly #fetch: typeof fetch;

  constructor({ url = VLIBRAS_TRANSLATE_URL, fetch: fetchFn }: VLibrasApiTranslatorOptions = {}) {
    this.#url = url;
    this.#fetch = fetchFn ?? ((input, init) => fetch(input, init));
  }

  async translate(text: string, signal?: AbortSignal): Promise<GlossResult> {
    const response = await this.#fetch(this.#url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal,
    });
    if (!response.ok) throw new Error(`VLibras respondeu com status ${response.status}`);
    const gloss = (await response.text()).trim();
    if (!gloss) throw new Error("VLibras devolveu uma glosa vazia");
    return { gloss, source: this.name };
  }
}
