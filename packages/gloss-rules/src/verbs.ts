import { IRREGULAR_VERBS, NOT_VERBS, REGULAR_VERBS } from "./lexicon";

/**
 * Como uma forma pode ser lida como verbo:
 * - "1sg": só quando "eu" vem antes (evita "o trabalho" → TRABALHAR);
 * - "finite": quando a palavra anterior não é determinante.
 */
export type VerbFormKind = "1sg" | "finite";

export interface VerbForm {
  lemma: string;
  kind: VerbFormKind;
}

// Sem a 2ª pessoa do singular ("tu falas"): é rara no Brasil e colide com plurais
// ("filmes", "contas", "provas").
const ENDINGS = {
  ar: {
    "1sg": ["o"],
    finite: [
      "a",
      "amos",
      "am",
      "ei",
      "ou",
      "aram",
      "ava",
      "ávamos",
      "avam",
      "arei",
      "ará",
      "aremos",
      "arão",
      "aria",
      "ariam",
      "ando",
      // Imperativo e subjuntivo ("fale", "espere", "fique").
      "e",
      "em",
    ],
  },
  er: {
    "1sg": ["o"],
    finite: [
      "e",
      "emos",
      "em",
      "i",
      "eu",
      "eram",
      "ia",
      "íamos",
      "iam",
      "erei",
      "erá",
      "eremos",
      "erão",
      "eria",
      "eriam",
      "endo",
      // Imperativo e subjuntivo ("coma", "escreva", "conheça").
      "a",
      "am",
    ],
  },
  ir: {
    "1sg": ["o"],
    finite: [
      "e",
      "imos",
      "em",
      "i",
      "iu",
      "iram",
      "ia",
      "íamos",
      "iam",
      "irei",
      "irá",
      "iremos",
      "irão",
      "iria",
      "iriam",
      "indo",
      // Imperativo e subjuntivo ("abra", "decida", "dirija").
      "a",
      "am",
    ],
  },
} as const;

const SPELLING = {
  // -ar: o radical muda antes de "e" (fic-ar → fiqu-ei, pag-ar → pagu-ei, começ-ar → comec-ei).
  ar: { vowels: "e", changes: { c: "qu", g: "gu", ç: "c" } },
  // -er/-ir: o radical muda antes de "o"/"a" (conhec-er → conheç-o, dirig-ir → dirij-o).
  er: { vowels: "oa", changes: { c: "ç", g: "j" } },
  ir: { vowels: "oa", changes: { c: "ç", g: "j" } },
} as const;

function spell(group: keyof typeof SPELLING, stem: string, ending: string): string {
  const { vowels, changes } = SPELLING[group];
  const last = stem.slice(-1) as keyof typeof changes;
  if (vowels.includes(ending.charAt(0)) && last in changes) {
    return `${stem.slice(0, -1)}${changes[last]}${ending}`;
  }
  return `${stem}${ending}`;
}

// Terminações em que o radical é tônico: nos verbos em -ear ganham um "i" (passe-ar → passei-o).
const STRESSED_ENDINGS = new Set(["o", "as", "a", "am", "e", "es", "em"]);

// Verbos em -uir trocam "e" por "i" e acentuam o "i" do hiato (inclu-ir → inclui, incluí, incluía).
const UIR_ENDINGS: Readonly<Record<string, string>> = {
  e: "i",
  es: "is",
  i: "í",
  imos: "ímos",
  iram: "íram",
  ia: "ía",
  ias: "ías",
  iam: "íam",
};

export function conjugate(infinitive: string): Array<[string, VerbForm]> {
  const group = infinitive.slice(-2) as keyof typeof ENDINGS;
  const endings = ENDINGS[group];
  if (!endings) return [];
  const stem = infinitive.slice(0, -2);
  const ear = group === "ar" && stem.endsWith("e");
  const uir = group === "ir" && stem.endsWith("u");
  const forms: Array<[string, VerbForm]> = [];
  for (const kind of ["1sg", "finite"] as const) {
    for (const ending of endings[kind]) {
      let form: string;
      if (ear && STRESSED_ENDINGS.has(ending)) form = `${stem}i${ending}`;
      else if (uir) form = `${stem}${UIR_ENDINGS[ending] ?? ending}`;
      else form = spell(group, stem, ending);
      forms.push([form, { lemma: infinitive, kind }]);
    }
  }
  return forms;
}

let table: Map<string, VerbForm> | undefined;
let fullTable: Map<string, VerbForm> | undefined;

/** Tabela das formas dos verbos do pacote; `includeNouns` mantém as de NOT_VERBS. */
function verbTable(includeNouns = false): Map<string, VerbForm> {
  const cached = includeNouns ? fullTable : table;
  if (cached) return cached;
  const built = new Map<string, VerbForm>();
  for (const infinitive of REGULAR_VERBS) {
    built.set(infinitive, { lemma: infinitive, kind: "finite" });
    for (const [form, info] of conjugate(infinitive)) {
      if ((includeNouns || !NOT_VERBS.has(form)) && !built.has(form)) built.set(form, info);
    }
  }
  for (const [form, lemma] of Object.entries(IRREGULAR_VERBS)) {
    built.set(form, { lemma, kind: "finite" });
    built.set(lemma, { lemma, kind: "finite" });
  }
  if (includeNouns) fullTable = built;
  else table = built;
  return built;
}

/** Só a lista do pacote (regulares, irregulares e suas formas). */
export function lookupVerb(
  word: string,
  options: { includeNouns?: boolean } = {},
): VerbForm | undefined {
  return verbTable(options.includeNouns).get(word);
}

/** Heurística de infinitivo: verbo conhecido ou terminação -ar/-er/-ir/-or. */
export function isInfinitive(word: string): boolean {
  const verb = lookupVerb(word);
  if (verb) return verb.lemma === word;
  return word.length > 3 && /(ar|er|ir|or|ôr)$/.test(word);
}

/** Sinais disponíveis no dicionário do avatar, em maiúsculas (ex.: `GOSTAR`, `BOM_DIA`). */
export type Vocabulary = ReadonlySet<string>;

export const toSign = (word: string) => word.toLocaleUpperCase("pt-BR");

const vocabularyTables = new WeakMap<Vocabulary, Map<string, VerbForm>>();

/** Formas conjugadas de todos os infinitivos do dicionário. */
function vocabularyVerbTable(vocabulary: Vocabulary): Map<string, VerbForm> {
  let table = vocabularyTables.get(vocabulary);
  if (table) return table;
  table = new Map();
  for (const sign of vocabulary) {
    if (sign.length < 4 || !/^[A-ZÀ-Ý]+(AR|ER|IR)$/.test(sign)) continue;
    const infinitive = sign.toLocaleLowerCase("pt-BR");
    table.set(infinitive, { lemma: infinitive, kind: "finite" });
    for (const [form, info] of conjugate(infinitive)) {
      if (!table.has(form)) table.set(form, info);
    }
  }
  vocabularyTables.set(vocabulary, table);
  return table;
}

/**
 * Procura o verbo primeiro na lista do pacote e depois entre os infinitivos do
 * dicionário. Uma palavra que é sinal por si só ("casa", "conta"), ou cujo
 * singular é ("mulheres"), não vira verbo pelo dicionário.
 */
export function findVerb(
  word: string,
  vocabulary?: Vocabulary,
  singularOf?: (word: string) => string,
): VerbForm | undefined {
  const known = lookupVerb(word);
  if (known || !vocabulary) return known;
  const form = vocabularyVerbTable(vocabulary).get(word);
  if (!form || form.lemma === word) return form;
  if (vocabulary.has(toSign(word))) return undefined;
  const single = singularOf?.(word);
  if (single && single !== word && vocabulary.has(toSign(single))) return undefined;
  return form;
}
