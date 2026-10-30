import { describe, expect, it } from "vitest";
import {
  type Condition,
  CSV_COLUMNS,
  DEFAULT_SENTENCES,
  keywordScore,
  normalizeAnswer,
  parseSentenceSet,
  planSession,
  seedFrom,
  type TestSentence,
  type TrialResult,
  toCsv,
} from "./evaluation";

const ALL: Condition[] = ["propio", "vlibras"];

describe("DEFAULT_SENTENCES", () => {
  it("tem ids únicos e cobre todas as categorias", () => {
    const ids = DEFAULT_SENTENCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(DEFAULT_SENTENCES.map((s) => s.category))).toEqual(
      new Set([
        "cotidiano",
        "datilologia",
        "numeros",
        "pergunta-sim-nao",
        "pergunta-qu",
        "negacao",
        "emocao",
      ]),
    );
  });

  it("acerta a própria frase com todas as palavras-chave", () => {
    for (const s of DEFAULT_SENTENCES) expect(keywordScore(s.text, s.keywords), s.id).toBe(1);
  });
});

describe("planSession", () => {
  it("mostra cada frase uma vez, numa ordem que depende só da semente", () => {
    const a = planSession(DEFAULT_SENTENCES, ALL, 0, seedFrom("P01"));
    const b = planSession(DEFAULT_SENTENCES, ALL, 0, seedFrom("P01"));
    const c = planSession(DEFAULT_SENTENCES, ALL, 0, seedFrom("P02"));
    expect(a.map((t) => t.sentence.id).sort()).toEqual(DEFAULT_SENTENCES.map((s) => s.id).sort());
    expect(a.map((t) => t.sentence.id)).toEqual(b.map((t) => t.sentence.id));
    expect(a.map((t) => t.sentence.id)).not.toEqual(c.map((t) => t.sentence.id));
  });

  it("divide as condições por igual e troca a condição de cada frase entre participantes", () => {
    const first = planSession(DEFAULT_SENTENCES, ALL, 0, 1);
    const second = planSession(DEFAULT_SENTENCES, ALL, 1, 1);
    const count = (c: Condition) => first.filter((t) => t.condition === c).length;
    expect(count("propio")).toBe(count("vlibras"));
    const conditionOf = (trials: typeof first, id: string) =>
      trials.find((t) => t.sentence.id === id)?.condition;
    for (const s of DEFAULT_SENTENCES) {
      expect(conditionOf(first, s.id)).not.toBe(conditionOf(second, s.id));
    }
  });

  it("só usa a condição vídeo nas frases que têm vídeo", () => {
    const sentences: TestSentence[] = DEFAULT_SENTENCES.slice(0, 6).map((s, i) =>
      i % 2 ? { ...s, video: `v${i}.mp4` } : s,
    );
    for (let p = 0; p < 3; p++) {
      for (const t of planSession(sentences, ["propio", "vlibras", "video"], p, 7)) {
        if (t.condition === "video") expect(t.sentence.video).toBeTruthy();
      }
    }
    expect(planSession(sentences.slice(0, 1), ["video"], 0, 1)[0]?.condition).toBe("propio");
  });

  it("recusa uma sessão sem condições", () => {
    expect(() => planSession(DEFAULT_SENTENCES, [], 0, 1)).toThrow();
  });
});

describe("keywordScore", () => {
  const keywords = [["nao"], ["gosto", "gostar"], ["chuva"]];

  it("ignora acentos, maiúsculas e pontuação", () => {
    expect(normalizeAnswer("  Não GOSTO, de chuva!! ")).toBe("nao gosto de chuva");
    expect(keywordScore("Não gosto de CHUVA", keywords)).toBe(1);
  });

  it("dá crédito parcial e compara pelo começo das palavras", () => {
    expect(keywordScore("gosto de chuva", keywords)).toBe(0.67);
    expect(keywordScore("agosto", [["gosto"]])).toBe(0);
    expect(keywordScore("", keywords)).toBe(0);
    expect(keywordScore("qualquer", [])).toBe(0);
  });

  it("aceita o ponto de interrogação como palavra-chave", () => {
    expect(keywordScore("você está bem?", [["bem"], ["?"]])).toBe(1);
    expect(keywordScore("você está bem", [["bem"], ["?"]])).toBe(0.5);
  });
});

describe("toCsv", () => {
  const result: TrialResult = {
    participant: "P01",
    session: "2026-10-30T10:00:00.000Z",
    trial: 1,
    sentenceId: "g1",
    category: "negacao",
    condition: "propio",
    text: "Eu não gosto de chuva.",
    gloss: "EU NÃO_GOSTAR CHUVA [PONTO]",
    answer: 'ele disse "não", acho',
    keywordScore: 0.33,
    naturalness: 4,
    confidence: null,
    replays: 1,
    responseSeconds: 12.5,
    comment: "=SOMA(A1)",
    startedAt: "2026-10-30T10:00:05.000Z",
  };

  it("gera cabeçalho e aspas onde precisa, sem deixar fórmulas", () => {
    const lines = toCsv([result]).trimEnd().split("\r\n");
    expect(lines[0]).toBe(CSV_COLUMNS.join(","));
    expect(lines[1]).toContain('"ele disse ""não"", acho"');
    expect(lines[1]).toContain(`"'=SOMA(A1)"`);
    expect(lines[1]).toContain(",4,,1,12.5,");
  });
});

describe("parseSentenceSet", () => {
  it("lê um conjunto válido e completa os campos opcionais", () => {
    const [s] = parseSentenceSet([{ id: "x", text: "Oi", gloss: "OI", video: "oi.mp4" }]);
    expect(s).toEqual({
      id: "x",
      category: "cotidiano",
      text: "Oi",
      gloss: "OI",
      keywords: [],
      video: "oi.mp4",
    });
  });

  it("recusa listas vazias, ids repetidos e frases sem glosa", () => {
    expect(() => parseSentenceSet([])).toThrow();
    expect(() =>
      parseSentenceSet([
        { id: "a", text: "A", gloss: "A" },
        { id: "a", text: "B", gloss: "B" },
      ]),
    ).toThrow(/repetido/);
    expect(() => parseSentenceSet([{ id: "a", text: "A" }])).toThrow(/gloss/);
  });
});
