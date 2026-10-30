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

const ENDINGS = {
  ar: {
    "1sg": ["o"],
    finite: [
      "as",
      "a",
      "amos",
      "am",
      "ei",
      "ou",
      "aram",
      "ava",
      "avas",
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
      "es",
      "em",
    ],
  },
  er: {
    "1sg": ["o"],
    finite: [
      "es",
      "e",
      "emos",
      "em",
      "i",
      "eu",
      "eram",
      "ia",
      "ias",
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
      "as",
      "am",
    ],
  },
  ir: {
    "1sg": ["o"],
    finite: [
      "es",
      "e",
      "imos",
      "em",
      "i",
      "iu",
      "iram",
      "ia",
      "ias",
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
      "as",
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

function conjugate(infinitive: string): Array<[string, VerbForm]> {
  const group = infinitive.slice(-2) as keyof typeof ENDINGS;
  const endings = ENDINGS[group];
  if (!endings) return [];
  const stem = infinitive.slice(0, -2);
  const forms: Array<[string, VerbForm]> = [];
  for (const kind of ["1sg", "finite"] as const) {
    for (const ending of endings[kind]) {
      forms.push([spell(group, stem, ending), { lemma: infinitive, kind }]);
    }
  }
  return forms;
}

let table: Map<string, VerbForm> | undefined;

function verbTable(): Map<string, VerbForm> {
  if (table) return table;
  table = new Map();
  for (const infinitive of REGULAR_VERBS) {
    table.set(infinitive, { lemma: infinitive, kind: "finite" });
    for (const [form, info] of conjugate(infinitive)) {
      if (!NOT_VERBS.has(form) && !table.has(form)) table.set(form, info);
    }
  }
  for (const [form, lemma] of Object.entries(IRREGULAR_VERBS)) {
    table.set(form, { lemma, kind: "finite" });
    table.set(lemma, { lemma, kind: "finite" });
  }
  return table;
}

export function lookupVerb(word: string): VerbForm | undefined {
  return verbTable().get(word);
}

/** Heurística de infinitivo: verbo conhecido ou terminação -ar/-er/-ir/-or. */
export function isInfinitive(word: string): boolean {
  const verb = lookupVerb(word);
  if (verb) return verb.lemma === word;
  return word.length > 3 && /(ar|er|ir|or|ôr)$/.test(word);
}
