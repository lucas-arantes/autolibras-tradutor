import type { GlossResult, GlossTranslator } from "@autolibras/core";
import {
  COPULA,
  DESTINATION_WORDS,
  DETERMINERS,
  DROPPED,
  FOI_FORMS,
  IR_AUXILIARY,
  MASCULINE,
  NOT_PLURALS,
  NUMBERS,
  PHRASES,
  SINGULAR_EXCEPTIONS,
} from "./lexicon";
import { findVerb, isInfinitive, lookupVerb, toSign, type Vocabulary } from "./verbs";

const MARKERS: Readonly<Record<string, string>> = {
  ".": "[PONTO]",
  "?": "[INTERROGAÇÃO]",
  "!": "[EXCLAMAÇÃO]",
};

const CLITICS = new Set(["me", "te", "se", "lhe", "lhes", "nos"]);

interface Token {
  word: string;
  /** Glosa já resolvida (expressões compostas). */
  gloss?: string;
}

const PHRASE_TABLE = PHRASES.map(([phrase, gloss]) => [phrase.split(" "), gloss] as const).sort(
  (a, b) => b[0].length - a[0].length,
);

/** Maior expressão do dicionário que começa em `index` ("fim de semana" → FIM_DE_SEMANA). */
function vocabularyPhrase(words: string[], index: number, vocabulary: Vocabulary): number {
  for (let size = Math.min(4, words.length - index); size >= 2; size--) {
    if (vocabulary.has(toSign(words.slice(index, index + size).join("_")))) return size;
  }
  return 0;
}

function mergePhrases(words: string[], vocabulary?: Vocabulary): Token[] {
  const tokens: Token[] = [];
  for (let i = 0; i < words.length; i++) {
    const match = PHRASE_TABLE.find(([parts]) => parts.every((part, j) => words[i + j] === part));
    const size = match ? 0 : vocabulary ? vocabularyPhrase(words, i, vocabulary) : 0;
    if (match) {
      tokens.push({ word: match[0].join(" "), gloss: match[1] });
      i += match[0].length - 1;
    } else if (size > 0) {
      const parts = words.slice(i, i + size);
      tokens.push({ word: parts.join(" "), gloss: toSign(parts.join("_")) });
      i += size - 1;
    } else {
      tokens.push({ word: words[i] as string });
    }
  }
  return tokens;
}

const SINGULAR_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/ões$/, "ão"],
  [/ães$/, "ão"],
  [/ãos$/, "ão"],
  [/ais$/, "al"],
  [/éis$/, "el"],
  [/óis$/, "ol"],
  [/ns$/, "m"],
  [/([rz])es$/, "$1"],
  [/([aeiouã])s$/, "$1"],
];

/** Singular aproximado de um substantivo ou adjetivo no plural. */
export function singular(word: string): string {
  if (word.length < 4 || NOT_PLURALS.has(word) || word.endsWith("mos")) return word;
  const exception = SINGULAR_EXCEPTIONS[word];
  if (exception) return exception;
  for (const [pattern, replacement] of SINGULAR_RULES) {
    if (pattern.test(word)) return word.replace(pattern, replacement);
  }
  return word;
}

/** Palavra anterior com conteúdo, pulando pronomes oblíquos ("eu me lembro"). */
function previousWord(
  tokens: Token[],
  index: number,
  skip: ReadonlySet<string>,
): string | undefined {
  for (let i = index - 1; i >= 0; i--) {
    const word = tokens[i]?.word;
    if (word && !skip.has(word)) return word;
  }
  return undefined;
}

// Palavras que podem ficar entre o sujeito e o verbo ("eu sempre escovo").
const SKIP_BEFORE_VERB = new Set([
  ...CLITICS,
  "não",
  "sempre",
  "nunca",
  "também",
  "já",
  "ainda",
  "só",
  "agora",
  "logo",
]);

// Depois de um pronome sujeito, uma palavra ambígua ("costura", "planta") é verbo.
const SUBJECT_PRONOUNS = new Set(["ele", "ela", "você", "nós", "eles", "elas", "vocês", "gente"]);

function glossVerb(
  tokens: Token[],
  index: number,
  word: string,
  vocabulary?: Vocabulary,
): string | undefined {
  const subject = previousWord(tokens, index, SKIP_BEFORE_VERB);
  if (subject !== undefined && SUBJECT_PRONOUNS.has(subject)) {
    const forced = lookupVerb(word, { includeNouns: true }) ?? findVerb(word, vocabulary);
    if (forced && forced.kind === "finite") return forced.lemma;
  }
  const verb = findVerb(word, vocabulary, singular);
  if (!verb) return undefined;
  if (verb.kind === "1sg") {
    // Com "eu" antes ou no início da frase, já que o sujeito costuma ser omitido ("Moro em...").
    const previous = previousWord(tokens, index, SKIP_BEFORE_VERB);
    return previous === undefined || previous === "eu" ? verb.lemma : undefined;
  }
  const previous = tokens[index - 1]?.word;
  return previous && DETERMINERS.has(previous) ? undefined : verb.lemma;
}

/** Converte "vinte e cinco" em 25; retorna o valor e quantos tokens consumiu. */
function readNumber(tokens: Token[], index: number): [number, number] | undefined {
  const value = NUMBERS[tokens[index]?.word ?? ""];
  if (value === undefined) return undefined;
  const unitWord = tokens[index + 2]?.word ?? "";
  const unit = unitWord === "um" || unitWord === "uma" ? 1 : NUMBERS[unitWord];
  const isTens = value >= 20 && value <= 90 && value % 10 === 0;
  if (isTens && tokens[index + 1]?.word === "e" && unit !== undefined && unit >= 1 && unit <= 9) {
    return [value + unit, 3];
  }
  return [value, 1];
}

interface Sign {
  gloss: string;
  verb: boolean;
}

/**
 * Monta a glosa de uma frase. Trata a negação como o VLibras: unida ao verbo
 * seguinte (NÃO_GOSTAR) ou depois de um predicado não verbal (LONGE NÃO). Trata
 * "muito" como intensidade: no verbo anterior (TRABALHAR(+)) ou na próxima
 * palavra (BONITO(+)).
 */
class GlossBuilder {
  readonly #signs: Sign[] = [];
  #negate = false;
  #intensify = false;

  negate(): void {
    this.#negate = true;
  }

  /** `nextIsContent`: a próxima palavra tem sinal próprio e pode receber a intensidade. */
  intensify(nextIsContent: boolean): void {
    const last = this.#signs.at(-1);
    if (!nextIsContent && last?.verb && !last.gloss.endsWith("(+)")) last.gloss += "(+)";
    else this.#intensify = true;
  }

  push(gloss: string, verb = false): void {
    const sign = this.#intensify ? `${gloss}(+)` : gloss;
    this.#intensify = false;
    if (!this.#negate) {
      this.#signs.push({ gloss: sign, verb });
      return;
    }
    this.#negate = false;
    if (verb) this.#signs.push({ gloss: `NÃO_${sign}`, verb });
    else this.#signs.push({ gloss: sign, verb }, { gloss: "NÃO", verb: false });
  }

  finish(marker: string | undefined): string {
    if (this.#intensify) this.#signs.push({ gloss: "MUITO", verb: false });
    if (this.#negate) this.#signs.push({ gloss: "NÃO", verb: false });
    const glosses = this.#signs.map((sign) => sign.gloss);
    if (glosses.length > 0 && marker) glosses.push(marker);
    return glosses.join(" ");
  }
}

/**
 * Forma do substantivo ou adjetivo: singular e masculino, como nas glosas do
 * VLibras. Com o dicionário, mantém a forma original quando só ela existe
 * (LIBRAS) e usa o masculino de substantivos que não têm sinal no feminino
 * (PROFESSORA → PROFESSOR).
 */
function nounForm(word: string, vocabulary?: Vocabulary, adjective = false): string {
  let base = singular(word);
  if (vocabulary && !vocabulary.has(toSign(base)) && vocabulary.has(toSign(word))) base = word;
  const masculine = MASCULINE[base];
  if (masculine) return masculine;
  if (
    adjective &&
    vocabulary &&
    base.endsWith("a") &&
    vocabulary.has(toSign(`${base.slice(0, -1)}o`))
  ) {
    // "estão muito caras" → CARO, como o VLibras faz com adjetivos.
    return `${base.slice(0, -1)}o`;
  }
  if (!vocabulary || vocabulary.has(toSign(base))) return base;
  const candidates = [
    base.endsWith("ora") ? base.slice(0, -1) : "",
    base.endsWith("a") ? `${base.slice(0, -1)}o` : "",
  ];
  return candidates.find((c) => c && vocabulary.has(toSign(c))) ?? base;
}

function glossSentence(sentence: string, vocabulary?: Vocabulary): string {
  const trimmed = sentence.trim();
  const marker = MARKERS[trimmed.slice(-1)];
  const words = trimmed.toLocaleLowerCase("pt-BR").match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu);
  if (!words) return "";
  const tokens = mergePhrases(words, vocabulary);
  const output = new GlossBuilder();

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as Token;
    const { word } = token;
    const next = tokens[i + 1]?.word;

    if (token.gloss) {
      // "por que" no meio de uma afirmação é conjunção ("não entendo por que ele saiu").
      if (token.gloss === "PORQUE" && i > 0 && marker !== "[INTERROGAÇÃO]") continue;
      output.push(token.gloss);
      continue;
    }
    if (word === "não") {
      output.negate();
      continue;
    }
    if (word === "muito") {
      // "fala muito rápido" → RÁPIDO(+); "gosto muito de café" → GOSTAR(+).
      // Expressões (TODO_DIA, BOM_DIA) não recebem intensidade.
      const nextIsContent =
        next !== undefined &&
        !tokens[i + 1]?.gloss &&
        !DROPPED.has(next) &&
        !COPULA.has(next) &&
        !findVerb(next, vocabulary, singular);
      output.intensify(nextIsContent);
      continue;
    }
    const number = readNumber(tokens, i);
    if (number) {
      output.push(String(number[0]));
      i += number[1] - 1;
      // "às oito" → 8 HORA ("às oito horas" já traz a palavra).
      const after = tokens[i + 1]?.word;
      if (tokens[i - number[1]]?.word === "às" && after !== "hora" && after !== "horas") {
        output.push("HORA");
      }
      continue;
    }
    if (word === "que") {
      // Mantido só no início ("Que legal!"); no meio da frase é conjunção.
      if (i === 0) output.push("QUE");
      continue;
    }
    if (DROPPED.has(word)) continue;
    if (FOI_FORMS.has(word)) {
      if (next && DESTINATION_WORDS.has(next)) output.push("IR", true);
      continue;
    }
    if (COPULA.has(word)) continue;
    if (IR_AUXILIARY.has(word)) {
      // "vou estudar" → ESTUDAR (o futuro fica nos advérbios de tempo, como no VLibras);
      // "vamos comemorar" é um convite: VAMOS.
      if (word === "vamos" && next && isInfinitive(next)) output.push("VAMOS");
      else if (!(next && isInfinitive(next))) output.push("IR", true);
      continue;
    }

    const lemma = glossVerb(tokens, i, word, vocabulary);
    const previous = tokens[i - 1]?.word ?? "";
    const adjective = COPULA.has(previous) || previous === "muito" || previous === "mais";
    const base = lemma ?? nounForm(word, vocabulary, adjective);
    // Palavras compostas usam "_" como as expressões (GUARDA_CHUVA).
    output.push(toSign(base.replaceAll("-", "_")), lemma !== undefined);
  }

  return output.finish(marker);
}

/**
 * Traduz português para glosa de Libras com regras locais. O dicionário de
 * sinais (opcional) melhora verbos, expressões e formas das palavras.
 */
export function toGloss(text: string, vocabulary?: Vocabulary): string {
  const sentences = text.normalize("NFC").match(/[^.!?]+[.!?]*/g) ?? [];
  return sentences
    .map((sentence) => glossSentence(sentence, vocabulary))
    .filter(Boolean)
    .join(" ");
}

export class RulesTranslator implements GlossTranslator {
  readonly name = "regras";
  #vocabulary: Vocabulary | undefined;

  constructor(vocabulary?: Vocabulary) {
    this.#vocabulary = vocabulary;
  }

  /** Passa a usar o dicionário de sinais (carregado depois, em segundo plano). */
  setVocabulary(vocabulary: Vocabulary | undefined): void {
    this.#vocabulary = vocabulary;
  }

  async translate(text: string): Promise<GlossResult> {
    return { gloss: toGloss(text, this.#vocabulary), source: this.name };
  }
}
