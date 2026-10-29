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
import { isInfinitive, lookupVerb } from "./verbs";

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

function mergePhrases(words: string[]): Token[] {
  const tokens: Token[] = [];
  for (let i = 0; i < words.length; i++) {
    const match = PHRASE_TABLE.find(([parts]) => parts.every((part, j) => words[i + j] === part));
    if (match) {
      tokens.push({ word: match[0].join(" "), gloss: match[1] });
      i += match[0].length - 1;
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

const SKIP_BEFORE_VERB = new Set([...CLITICS, "não"]);

function glossVerb(tokens: Token[], index: number, word: string): string | undefined {
  const verb = lookupVerb(word);
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

function glossSentence(sentence: string): string {
  const trimmed = sentence.trim();
  const marker = MARKERS[trimmed.slice(-1)];
  const words = trimmed.toLocaleLowerCase("pt-BR").match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu);
  if (!words) return "";
  const tokens = mergePhrases(words);
  const output: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as Token;
    const { word } = token;
    const next = tokens[i + 1]?.word;

    if (token.gloss) {
      output.push(token.gloss);
      continue;
    }
    const number = readNumber(tokens, i);
    if (number) {
      output.push(String(number[0]));
      i += number[1] - 1;
      continue;
    }
    if (word === "que") {
      // Mantido só no início ("Que legal!"); no meio da frase é conjunção.
      if (i === 0) output.push("QUE");
      continue;
    }
    if (DROPPED.has(word)) continue;
    if (FOI_FORMS.has(word)) {
      if (next && DESTINATION_WORDS.has(next)) output.push("IR");
      continue;
    }
    if (COPULA.has(word)) continue;
    if (IR_AUXILIARY.has(word)) {
      // "vou estudar" → ESTUDAR (o futuro fica nos advérbios de tempo, como no VLibras).
      if (!(next && isInfinitive(next))) output.push("IR");
      continue;
    }

    const lemma = glossVerb(tokens, i, word);
    const base = lemma ?? singular(word);
    output.push((MASCULINE[base] ?? base).toLocaleUpperCase("pt-BR"));
  }

  if (output.length > 0 && marker) output.push(marker);
  return output.join(" ");
}

/** Traduz português para glosa de Libras com regras locais, sem rede. */
export function toGloss(text: string): string {
  const sentences = text.normalize("NFC").match(/[^.!?]+[.!?]*/g) ?? [];
  return sentences.map(glossSentence).filter(Boolean).join(" ");
}

export class RulesTranslator implements GlossTranslator {
  readonly name = "regras";

  async translate(text: string): Promise<GlossResult> {
    return { gloss: toGloss(text), source: this.name };
  }
}
