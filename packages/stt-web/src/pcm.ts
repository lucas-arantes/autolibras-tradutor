/** Taxa de amostragem esperada pelo servidor de transcrição. */
export const TARGET_SAMPLE_RATE = 16_000;

/**
 * Converte áudio float32 na taxa do microfone (44,1 ou 48 kHz, em geral) para
 * PCM 16 bits a 16 kHz. Calcula a média de cada janela de entrada, o que já
 * serve de filtro passa-baixa simples. Guarda o resto entre blocos, então pode
 * receber pedaços de qualquer tamanho.
 */
export class Pcm16Encoder {
  readonly #ratio: number;
  #pending: number[] = [];
  #position = 0;

  constructor(inputSampleRate: number) {
    if (inputSampleRate < TARGET_SAMPLE_RATE) {
      throw new Error(`Taxa de entrada (${inputSampleRate} Hz) menor que ${TARGET_SAMPLE_RATE} Hz`);
    }
    this.#ratio = inputSampleRate / TARGET_SAMPLE_RATE;
  }

  /** Recebe amostras float32 e devolve as amostras PCM 16 bits já completas. */
  push(input: Float32Array): Int16Array {
    for (const sample of input) this.#pending.push(sample);
    const output: number[] = [];
    while (this.#position + this.#ratio <= this.#pending.length) {
      const start = Math.floor(this.#position);
      const end = Math.floor(this.#position + this.#ratio);
      let sum = 0;
      for (let i = start; i < end; i++) sum += this.#pending[i] as number;
      output.push(toInt16(sum / Math.max(1, end - start)));
      this.#position += this.#ratio;
    }
    // Descarta o que já foi consumido, mantendo a fração da próxima janela.
    const consumed = Math.floor(this.#position);
    this.#pending = this.#pending.slice(consumed);
    this.#position -= consumed;
    return Int16Array.from(output);
  }
}

export function toInt16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
}
