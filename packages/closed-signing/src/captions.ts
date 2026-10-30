/**
 * Legenda → frases para o avatar. Tira marcação, descrições de som e marcas de
 * falante, remove a repetição das legendas em rolagem (cada deixa repete o fim
 * da anterior) e junta os pedaços em frases.
 */

const TAG = /<[^>]*>|\{\\[^}]*\}/g;
/** Descrições de som, como "(música)" e "[aplausos]", e marcas de troca de falante. */
const NON_SPEECH = /\([^)]*\)|\[[^\]]*\]|>>+|♪+/g;
const SENTENCE_END = /[.?!…]['")\]]*$/;

export function cleanCaption(text: string): string {
  return text.replace(TAG, " ").replace(NON_SPEECH, " ").split(/\s+/).filter(Boolean).join(" ");
}

const key = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

export class CaptionAssembler {
  #recent: string[] = [];
  #pending: string[] = [];

  /** `maxWords`: frase sem pontuação sai quando chega a esse tamanho. */
  constructor(readonly maxWords = 14) {}

  /** Recebe a próxima deixa (já limpa); devolve as frases que ficaram completas. */
  push(text: string): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    const fresh = words.slice(this.#overlap(words));
    this.#recent = [...this.#recent, ...fresh].slice(-60);
    const sentences: string[] = [];
    for (const word of fresh) {
      this.#pending.push(word);
      if (SENTENCE_END.test(word) || this.#pending.length >= this.maxWords) {
        sentences.push(this.#pending.join(" "));
        this.#pending = [];
      }
    }
    return sentences;
  }

  get pending(): string {
    return this.#pending.join(" ");
  }

  /** Solta o trecho incompleto (pausa na legenda, fim do vídeo). */
  flush(): string[] {
    if (this.#pending.length === 0) return [];
    const sentence = this.#pending.join(" ");
    this.#pending = [];
    return [sentence];
  }

  reset(): void {
    this.#recent = [];
    this.#pending = [];
  }

  /** Maior começo da deixa nova que repete o fim do que já foi visto. */
  #overlap(words: string[]): number {
    const recent = this.#recent.map(key);
    const keys = words.map(key);
    for (let size = Math.min(recent.length, keys.length); size > 0; size--) {
      if (recent.slice(-size).every((word, i) => word === keys[i])) return size;
    }
    return 0;
  }
}
