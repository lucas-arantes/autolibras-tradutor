/**
 * Lógica do teste de compreensão (`avaliacao.html`): frases, sorteio da ordem,
 * distribuição das condições, pontuação de apoio e exportação em CSV. O protocolo
 * completo está em `docs/avaliacao/protocolo.md`.
 */

/** O que cada frase testa. */
export type SentenceCategory =
  | "cotidiano"
  | "datilologia"
  | "numeros"
  | "pergunta-sim-nao"
  | "pergunta-qu"
  | "negacao"
  | "emocao";

/**
 * Condição em que a frase é mostrada: o avatar próprio, o avatar do VLibras ou o
 * vídeo de um intérprete humano (só quando a frase tem `video`).
 */
export type Condition = "propio" | "vlibras" | "video";

export interface TestSentence {
  id: string;
  category: SentenceCategory;
  /** Frase em português (a resposta esperada). */
  text: string;
  /** Glosa fixa: o teste avalia o avatar, não o tradutor. */
  gloss: string;
  /**
   * Palavras que a resposta precisa ter para a pontuação automática, cada uma com
   * as formas aceitas (sem acento e em minúsculas, como a resposta é comparada).
   */
  keywords: string[][];
  /** URL do vídeo do intérprete (condição `video`). */
  video?: string;
}

/** Frases do teste: cada categoria tem de 3 a 5 frases curtas, com sinais do dicionário. */
export const DEFAULT_SENTENCES: TestSentence[] = [
  {
    id: "c1",
    category: "cotidiano",
    text: "Eu gosto de café.",
    gloss: "EU GOSTAR CAFÉ [PONTO]",
    keywords: [["gosto", "gostar", "gosta"], ["cafe"]],
  },
  {
    id: "c2",
    category: "cotidiano",
    text: "Amanhã eu vou trabalhar cedo.",
    gloss: "AMANHÃ EU TRABALHAR CEDO [PONTO]",
    keywords: [["amanha"], ["trabalhar", "trabalho", "trabalha"], ["cedo"]],
  },
  {
    id: "c3",
    category: "cotidiano",
    text: "A escola fica perto da minha casa.",
    gloss: "ESCOLA PERTO CASA MEU [PONTO]",
    keywords: [["escola"], ["perto"], ["casa"]],
  },
  {
    id: "c4",
    category: "cotidiano",
    text: "Meu irmão mora em São Paulo.",
    gloss: "IRMÃO MEU MORAR SÃO_PAULO [PONTO]",
    keywords: [["irmao"], ["mora", "morar"], ["sao paulo", "sp"]],
  },
  {
    id: "c5",
    category: "cotidiano",
    text: "Obrigado pela ajuda.",
    gloss: "OBRIGADO AJUDAR [PONTO]",
    keywords: [["obrigad"], ["ajuda", "ajudar"]],
  },
  {
    id: "d1",
    category: "datilologia",
    text: "Meu nome é Ana.",
    gloss: "EU NOME A N A [PONTO]",
    keywords: [["nome", "chamo"], ["ana"]],
  },
  {
    id: "d2",
    category: "datilologia",
    text: "O professor se chama Beto.",
    gloss: "PROFESSOR NOME B E T O [PONTO]",
    keywords: [["professor"], ["beto"]],
  },
  {
    id: "d3",
    category: "datilologia",
    text: "Eu moro na rua Jasmim.",
    gloss: "EU MORAR RUA J A S M I M [PONTO]",
    keywords: [["rua"], ["jasmim"]],
  },
  {
    id: "d4",
    category: "datilologia",
    text: "O cachorro se chama Otto.",
    gloss: "CACHORRO NOME O T T O [PONTO]",
    keywords: [
      ["cachorro", "cao"],
      ["otto", "oto"],
    ],
  },
  {
    id: "n1",
    category: "numeros",
    text: "Eu tenho 25 anos.",
    gloss: "EU TER 25 ANO [PONTO]",
    keywords: [["25", "vinte e cinco"], ["ano"]],
  },
  {
    id: "n2",
    category: "numeros",
    text: "A reunião é às 8 horas.",
    gloss: "REUNIÃO 8 HORA [PONTO]",
    keywords: [["reuniao"], ["8", "oito"]],
  },
  {
    id: "n3",
    category: "numeros",
    text: "Eu nasci em 1998.",
    gloss: "EU NASCER 1998 [PONTO]",
    keywords: [
      ["nasci", "nascer", "nasceu"],
      ["1998", "mil novecentos e noventa e oito"],
    ],
  },
  {
    id: "n4",
    category: "numeros",
    text: "O carro custa 30 mil reais.",
    gloss: "CARRO CUSTAR 30000 REAL [PONTO]",
    keywords: [["carro"], ["30 mil", "30000", "30.000", "trinta mil"], ["rea"]],
  },
  {
    id: "q1",
    category: "pergunta-sim-nao",
    text: "Você está bem?",
    gloss: "VOCÊ BEM [INTERROGAÇÃO]",
    keywords: [["voce", "tudo"], ["bem"], ["?"]],
  },
  {
    id: "q2",
    category: "pergunta-sim-nao",
    text: "Você gosta de futebol?",
    gloss: "VOCÊ GOSTAR FUTEBOL [INTERROGAÇÃO]",
    keywords: [["gosta", "gostar"], ["futebol"], ["?"]],
  },
  {
    id: "q3",
    category: "pergunta-sim-nao",
    text: "Amanhã tem aula?",
    gloss: "AMANHÃ TER AULA [INTERROGAÇÃO]",
    keywords: [["amanha"], ["aula"], ["?"]],
  },
  {
    id: "w1",
    category: "pergunta-qu",
    text: "Qual é o seu nome?",
    gloss: "VOCÊ NOME QUAL [INTERROGAÇÃO]",
    keywords: [
      ["qual", "como"],
      ["nome", "chama"],
    ],
  },
  {
    id: "w2",
    category: "pergunta-qu",
    text: "Onde você mora?",
    gloss: "VOCÊ MORAR ONDE [INTERROGAÇÃO]",
    keywords: [["onde"], ["mora", "morar"]],
  },
  {
    id: "w3",
    category: "pergunta-qu",
    text: "Quando começa a aula?",
    gloss: "AULA COMEÇAR QUANDO [INTERROGAÇÃO]",
    keywords: [["quando", "que horas"], ["comec"], ["aula"]],
  },
  {
    id: "g1",
    category: "negacao",
    text: "Eu não gosto de chuva.",
    gloss: "EU NÃO_GOSTAR CHUVA [PONTO]",
    keywords: [["nao"], ["gosto", "gostar", "gosta"], ["chuva"]],
  },
  {
    id: "g2",
    category: "negacao",
    text: "Ele não quer sair hoje.",
    gloss: "ELE NÃO_QUERER SAIR HOJE [PONTO]",
    keywords: [["nao"], ["quer"], ["sair"], ["hoje"]],
  },
  {
    id: "g3",
    category: "negacao",
    text: "Não tem água.",
    gloss: "NÃO_TER ÁGUA [PONTO]",
    keywords: [["nao", "sem", "acabou"], ["agua"]],
  },
  {
    id: "e1",
    category: "emocao",
    text: "Estou muito feliz!",
    gloss: "EU FELIZ(+) [EXCLAMAÇÃO]",
    keywords: [["feliz", "alegre", "contente"]],
  },
  {
    id: "e2",
    category: "emocao",
    text: "Ela ficou triste.",
    gloss: "ELA TRISTE [PONTO]",
    keywords: [["ela"], ["triste"]],
  },
];

/** Gerador pseudoaleatório com semente (mulberry32): a mesma semente dá a mesma ordem. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Semente estável a partir do código do participante. */
export function seedFrom(text: string): number {
  let h = 2166136261;
  for (const ch of text) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface Trial {
  index: number;
  sentence: TestSentence;
  condition: Condition;
}

/**
 * Monta a sessão de um participante: cada frase aparece uma vez só, em ordem
 * sorteada pela semente, e as condições se alternam em rodízio (quadrado latino).
 * Com o número do participante, o rodízio começa em outra condição, então ao longo
 * dos participantes cada frase passa por todas as condições.
 *
 * Frases sem vídeo nunca caem na condição `video`: ficam com a próxima da lista.
 */
export function planSession(
  sentences: readonly TestSentence[],
  conditions: readonly Condition[],
  participant: number,
  seed: number,
): Trial[] {
  if (conditions.length === 0) throw new Error("Escolha pelo menos uma condição");
  const order = [...sentences];
  const random = seededRandom(seed);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j] as TestSentence, order[i] as TestSentence];
  }
  // O rodízio usa a posição da frase no conjunto (não na ordem sorteada), para que
  // participantes vizinhos vejam a mesma frase em condições diferentes.
  const position = new Map(sentences.map((s, i) => [s.id, i]));
  return order.map((sentence, index) => {
    const base = (position.get(sentence.id) ?? 0) + participant;
    let condition = conditions[base % conditions.length] as Condition;
    for (let k = 1; condition === "video" && !sentence.video && k < conditions.length; k++) {
      condition = conditions[(base + k) % conditions.length] as Condition;
    }
    if (condition === "video" && !sentence.video) condition = "propio";
    return { index, sentence, condition };
  });
}

/** Minúsculas, sem acentos e sem pontuação (exceto `?`), espaços simples. */
export function normalizeAnswer(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}?\s.]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pontuação automática de apoio, de 0 a 1: a fração das palavras-chave que aparecem
 * na resposta (qualquer das formas aceitas, como começo de palavra). Não substitui a
 * correção feita por pessoas, que avalia o sentido.
 */
export function keywordScore(answer: string, keywords: readonly string[][]): number {
  if (keywords.length === 0) return 0;
  const normalized = ` ${normalizeAnswer(answer)}`;
  const hits = keywords.filter((forms) =>
    forms.some((form) =>
      form === "?" ? normalized.includes("?") : normalized.includes(` ${normalizeAnswer(form)}`),
    ),
  ).length;
  return Math.round((hits / keywords.length) * 100) / 100;
}

export interface TrialResult {
  participant: string;
  session: string;
  trial: number;
  sentenceId: string;
  category: SentenceCategory;
  condition: Condition;
  text: string;
  gloss: string;
  /** O que a pessoa entendeu, nas palavras dela (ou transcrito por quem aplica). */
  answer: string;
  keywordScore: number;
  /** Naturalidade, de 1 (nada natural) a 5 (muito natural); vazio se não respondeu. */
  naturalness: number | null;
  /** Confiança na resposta, de 1 a 5. */
  confidence: number | null;
  replays: number;
  /** Segundos entre o fim da primeira exibição e o envio da resposta. */
  responseSeconds: number;
  comment: string;
  startedAt: string;
}

export const CSV_COLUMNS: Array<keyof TrialResult> = [
  "participant",
  "session",
  "trial",
  "sentenceId",
  "category",
  "condition",
  "text",
  "gloss",
  "answer",
  "keywordScore",
  "naturalness",
  "confidence",
  "replays",
  "responseSeconds",
  "comment",
  "startedAt",
];

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  // Aspas em tudo que pode quebrar a coluna; fórmulas viram texto nas planilhas.
  const safe = /^[=+\-@]/.test(text) && !/^-?\d/.test(text) ? `'${text}` : text;
  return /[",\n\r;]/.test(safe) || safe !== text ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** CSV (RFC 4180, separado por vírgula, com cabeçalho) para abrir em planilhas. */
export function toCsv(results: readonly TrialResult[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const result of results) lines.push(CSV_COLUMNS.map((c) => csvCell(result[c])).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

/** Valida um conjunto de frases carregado de um arquivo JSON. */
export function parseSentenceSet(json: unknown): TestSentence[] {
  if (!Array.isArray(json) || json.length === 0) {
    throw new Error("O arquivo precisa ter uma lista de frases");
  }
  const ids = new Set<string>();
  return json.map((item, i) => {
    const s = item as Partial<TestSentence>;
    if (typeof s.id !== "string" || !s.id || ids.has(s.id)) {
      throw new Error(`Frase ${i + 1}: id ausente ou repetido`);
    }
    if (typeof s.text !== "string" || typeof s.gloss !== "string") {
      throw new Error(`Frase ${s.id}: faltam text ou gloss`);
    }
    ids.add(s.id);
    return {
      id: s.id,
      category: s.category ?? "cotidiano",
      text: s.text,
      gloss: s.gloss,
      keywords: Array.isArray(s.keywords) ? s.keywords : [],
      ...(typeof s.video === "string" && s.video ? { video: s.video } : {}),
    };
  });
}
