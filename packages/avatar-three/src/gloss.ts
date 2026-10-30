/** Marcadores de frase que o VLibras e as regras locais acrescentam à glosa. */
export type SentenceMarker = "PONTO" | "INTERROGAÇÃO" | "EXCLAMAÇÃO";

export interface SignToken {
  kind: "sign";
  /** Token como veio na glosa (em maiúsculas). */
  raw: string;
  /** Sinal sem os sufixos `(+)` e `&...`. */
  base: string;
  /** Sufixo `(+)`: intensidade. */
  intense: boolean;
  /** Negação incorporada (`NÃO_GOSTAR`) ou o próprio sinal `NÃO`. */
  negated: boolean;
}

export interface MarkerToken {
  kind: "marker";
  raw: string;
  marker: SentenceMarker | string;
}

export type GlossToken = SignToken | MarkerToken;

export type SentenceType = "statement" | "question" | "whQuestion" | "exclamation";

export interface GlossSentence {
  signs: SignToken[];
  type: SentenceType;
}

/** Sinais interrogativos: com eles, a pergunta usa sobrancelhas franzidas, não erguidas. */
export const WH_SIGNS = new Set([
  "QUE",
  "O_QUE",
  "QUEM",
  "ONDE",
  "QUANDO",
  "COMO",
  "POR_QUE",
  "PORQUE",
  "QUAL",
  "QUANTO",
  "QUANTOS",
  "QUANTAS",
  "PARA_QUE",
]);

/** Pessoa gramatical dos verbos direcionais, como em `1S_IR_2S`. */
const PERSON_PREFIX = /^[123][SP]_/;
const PERSON_SUFFIX = /_[123][SP]$/;

export function normalizeGloss(text: string): string {
  return text.normalize("NFC").toLocaleUpperCase("pt-BR");
}

export function tokenize(gloss: string): GlossToken[] {
  const tokens: GlossToken[] = [];
  for (const piece of normalizeGloss(gloss).split(/\s+/)) {
    if (!piece) continue;
    const marker = /^\[(.+)\]$/.exec(piece);
    if (marker?.[1]) {
      tokens.push({ kind: "marker", raw: piece, marker: marker[1] });
      continue;
    }
    let base = piece;
    const intense = base.endsWith("(+)");
    if (intense) base = base.slice(0, -3);
    const amp = base.indexOf("&");
    if (amp > 0) base = base.slice(0, amp);
    if (!base) continue;
    const negated = base === "NÃO" || base.startsWith("NÃO_");
    tokens.push({ kind: "sign", raw: piece, base, intense, negated });
  }
  return tokens;
}

/** Agrupa os sinais em frases pelos marcadores e decide o tipo de cada frase. */
export function parseGloss(gloss: string): GlossSentence[] {
  const sentences: GlossSentence[] = [];
  let signs: SignToken[] = [];
  const close = (marker?: string) => {
    if (signs.length === 0) return;
    let type: SentenceType = "statement";
    if (marker === "INTERROGAÇÃO") {
      type = signs.some((s) => WH_SIGNS.has(s.base)) ? "whQuestion" : "question";
    } else if (marker === "EXCLAMAÇÃO") {
      type = "exclamation";
    }
    sentences.push({ signs, type });
    signs = [];
  };
  for (const token of tokenize(gloss)) {
    if (token.kind === "marker") close(token.marker);
    else signs.push(token);
  }
  close();
  return sentences;
}

/**
 * Nomes a procurar no pacote de sinais, do mais específico ao mais genérico: o token
 * completo (`CASA&LUGAR`), sem sufixos (`CASA`), o verbo direcional sem as pessoas
 * (`1S_IR_2S` → `IR`) e a negação separada (`NÃO_GOSTAR` → `GOSTAR`).
 */
export function lookupCandidates(token: SignToken): string[] {
  const out = [token.raw, token.raw.replace(/\(\+\)$/, ""), token.base];
  const bare = token.base.replace(PERSON_PREFIX, "").replace(PERSON_SUFFIX, "");
  out.push(bare);
  if (token.base.startsWith("NÃO_")) out.push(token.base.slice(4));
  return [...new Set(out.filter(Boolean))];
}

/** Letras para soletrar uma palavra; acentos viram a letra base, `Ç` é mantido. */
export function fingerspellLetters(word: string): string[] {
  const letters: string[] = [];
  for (const ch of normalizeGloss(word)) {
    if (ch === "Ç") {
      letters.push(ch);
      continue;
    }
    const plain = ch.normalize("NFD").replace(/\p{Diacritic}/gu, "");
    if (/^[A-Z0-9]$/.test(plain)) letters.push(plain);
  }
  return letters;
}

/** Letra soletrada isolada na glosa (`A`, `Ç`), como nos nomes próprios: `NOME A N A`. */
export function isLetterToken(token: SignToken): boolean {
  return token.raw === token.base && /^[A-ZÇ]$/u.test(token.base);
}

/** Separador de milhar: `1.500`, `2.000.000`. */
const THOUSANDS = /^\d{1,3}(\.\d{3})+$/;
const NUMBER = /^\d+(,\d+)?$/;

/**
 * Sinais para escrever um número em Libras, ou `null` se o token não for um número.
 *
 * Até quatro algarismos (`25`, `2010`), o número é sinalizado algarismo por algarismo,
 * como se faz com anos, idades e horas. A partir de cinco, os grupos de milhar ganham
 * os sinais `MIL` e `MILHÃO` (`25000` → `2 5 MIL`); grupos zerados são pulados. A parte
 * decimal vem depois de `VÍRGULA`.
 */
export function numberSigns(text: string): string[] | null {
  const plain = THOUSANDS.test(text) ? text.replaceAll(".", "") : text;
  if (!NUMBER.test(plain)) return null;
  const [integer = "", fraction] = plain.split(",");
  const out: string[] = [];
  if (integer.length <= 4) {
    out.push(...integer);
  } else {
    const digits = integer.replace(/^0+(?=\d)/, "");
    const groups: Array<[string, string | null]> = [
      [digits.slice(0, -6), "MILHÃO"],
      [digits.slice(-6, -3), "MIL"],
      [digits.slice(-3), null],
    ];
    for (const [group, word] of groups) {
      const value = group.replace(/^0+/, "");
      if (!value) continue;
      out.push(...value);
      if (word) out.push(word);
    }
    if (out.length === 0) out.push("0");
  }
  if (fraction) out.push("VÍRGULA", ...fraction);
  return out;
}
