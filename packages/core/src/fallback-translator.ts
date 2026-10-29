import type { GlossResult, GlossTranslator } from "./types";

/** Rejeita a promessa assim que o sinal for abortado, mesmo que ela o ignore. */
export function withSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Tenta cada tradutor em ordem, com tempo limite individual. Útil para usar um
 * serviço remoto e cair para as regras locais quando ele falha ou demora.
 */
export class FallbackTranslator implements GlossTranslator {
  readonly name: string;
  readonly #translators: readonly GlossTranslator[];
  readonly #timeoutMs: number;

  constructor(translators: readonly GlossTranslator[], timeoutMs = 4000) {
    if (translators.length === 0)
      throw new Error("FallbackTranslator precisa de ao menos um tradutor");
    this.#translators = translators;
    this.#timeoutMs = timeoutMs;
    this.name = translators.map((t) => t.name).join(" → ");
  }

  async translate(text: string, signal?: AbortSignal): Promise<GlossResult> {
    let lastError: unknown;
    for (const translator of this.#translators) {
      signal?.throwIfAborted();
      const timeout = AbortSignal.timeout(this.#timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      try {
        return await withSignal(translator.translate(text, combined), combined);
      } catch (error) {
        if (signal?.aborted) throw error;
        lastError = error;
      }
    }
    throw lastError;
  }
}
