import { describe, expect, it } from "vitest";
import { parseGloss } from "./gloss";
import {
  buildTimeline,
  DEFAULT_TIMELINE_OPTIONS,
  planGloss,
  resolveUnits,
  type SignCatalog,
  type SignInfo,
  segmentAt,
} from "./timeline";

function info(duration: number, strokeStart: number, strokeEnd: number, x = 0): SignInfo {
  const hand = [
    [x, 0, 0],
    [-x, 0, 0],
  ];
  return { duration, strokeStart, strokeEnd, hands: { strokeStart: hand, strokeEnd: hand } };
}

const SIGNS: Record<string, SignInfo> = {
  CASA: info(2.4, 0.8, 1.6),
  EU: info(2, 0.4, 1.3, 0.8),
  GOSTAR: info(3, 0.7, 2.3),
  BOM: info(2, 0.5, 1.5),
  DIA: info(2, 0.5, 1.5),
  QUAL: info(2, 0.5, 1.3),
  NOME: info(2.3, 0.6, 1.5),
  A: info(1.6, 0.5, 1.1),
  N: info(1.6, 0.5, 1.1),
};

const catalog: SignCatalog = { info: (name) => SIGNS[name], rest: "CASA" };

function units(gloss: string) {
  return resolveUnits(parseGloss(gloss), catalog).map((u) => `${u.kind}:${u.label}`);
}

describe("resolveUnits", () => {
  it("usa o clipe do sinal, sem os sufixos, quando ele existe", () => {
    expect(units("CASA&LUGAR EU GOSTAR(+)")).toEqual(["sign:CASA", "sign:EU", "sign:GOSTAR"]);
  });

  it("divide sinais compostos quando só as partes existem", () => {
    expect(units("BOM_DIA")).toEqual(["sign:BOM", "sign:DIA"]);
  });

  it("separa a negação e o verbo direcional", () => {
    expect(units("NÃO_GOSTAR 1S_GOSTAR_2S")).toEqual(["sign:GOSTAR", "sign:GOSTAR"]);
  });

  it("soletra palavras desconhecidas e usa placeholder quando faltam as letras", () => {
    expect(units("ANA XYZ")).toEqual(["letter:A", "letter:N", "letter:A", "placeholder:XYZ"]);
  });

  it("pula só as letras que faltam", () => {
    expect(units("ANTA")).toEqual(["letter:A", "letter:N", "letter:A"]);
  });
});

describe("buildTimeline", () => {
  it("toca só o trecho principal entre sinais e mantém a preparação e o retorno nas pontas", () => {
    const { segments, duration } = planGloss("CASA GOSTAR NOME", catalog);
    expect(segments.map((s) => [s.clip, s.from, s.to])).toEqual([
      ["CASA", 0, 1.6],
      ["GOSTAR", 0.7, 2.3],
      ["NOME", 0.6, 2.3],
    ]);
    // Contínua: cada segmento começa onde o anterior acaba.
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i]?.start).toBeCloseTo(segments[i - 1]?.end ?? Number.NaN);
    }
    const last = segments.at(-1);
    expect(duration).toBeCloseTo(last?.end ?? 0);
    expect(last?.end).toBeCloseTo((last?.start ?? 0) + (last?.blend ?? 0) + 1.7);
  });

  it("ajusta o crossfade à distância entre as mãos, dentro dos limites", () => {
    const { minBlend, maxBlend, firstBlend } = DEFAULT_TIMELINE_OPTIONS;
    const { segments } = planGloss("CASA GOSTAR EU CASA", catalog);
    expect(segments.map((s) => s.blend)).toEqual([firstBlend, minBlend, maxBlend, maxBlend]);
    for (const s of segments) {
      expect(s.blend).toBeGreaterThanOrEqual(0.1);
      expect(s.blend).toBeLessThanOrEqual(0.25);
    }
  });

  it("encurta as letras no meio da palavra soletrada", () => {
    const { segments } = planGloss("CASA ANA CASA", catalog);
    const letters = segments.filter((s) => s.unit.kind === "letter");
    expect(letters.map((s) => Math.round((s.to - s.from) * 100) / 100)).toEqual([
      DEFAULT_TIMELINE_OPTIONS.letterSeconds,
      DEFAULT_TIMELINE_OPTIONS.letterSeconds,
      0.6,
    ]);
  });

  it("deixa os sinais intensos mais lentos", () => {
    const [segment] = planGloss("CASA(+)", catalog).segments;
    expect(segment?.rate).toBe(DEFAULT_TIMELINE_OPTIONS.intenseRate);
    expect(segment?.end).toBeCloseTo(0.2 + 2.4 / 0.8);
  });

  it("usa a pose de repouso no placeholder", () => {
    const [segment] = planGloss("XYZ", catalog).segments;
    expect(segment).toMatchObject({ clip: "CASA", from: 0, to: 0, hold: 0.7 });
  });

  it("põe uma pausa entre frases", () => {
    const { segments } = planGloss("CASA [PONTO] EU", catalog);
    expect(segments[0]?.hold).toBe(DEFAULT_TIMELINE_OPTIONS.sentencePause);
    expect(segments[1]?.hold).toBe(0);
  });

  it("gera as pistas não manuais de perguntas, exclamações e negação", () => {
    const yesNo = planGloss("EU CASA [INTERROGAÇÃO]", catalog);
    expect(yesNo.expressions.map((e) => e.name)).toEqual(["browUp"]);
    const cue = yesNo.expressions[0];
    expect(cue?.start).toBe(0);
    expect(cue?.end).toBeGreaterThan(yesNo.segments[1]?.strokeEndAt ?? 0);
    expect(cue?.end).toBeLessThan(yesNo.duration);

    expect(planGloss("QUAL NOME [INTERROGAÇÃO]", catalog).expressions[0]?.name).toBe("browDown");
    expect(planGloss("CASA [EXCLAMAÇÃO]", catalog).expressions[0]?.name).toBe("surprised");

    const negation = planGloss("EU NÃO_GOSTAR CASA", catalog);
    const gostar = negation.segments[1];
    expect(negation.head).toEqual([
      {
        kind: "shake",
        start: (gostar?.start ?? 0) + (gostar?.blend ?? 0),
        end: gostar?.strokeEndAt,
      },
    ]);
    expect(negation.expressions).toEqual([
      expect.objectContaining({ name: "browDown", weight: 0.6 }),
    ]);
  });

  it("devolve uma linha do tempo vazia sem sinais", () => {
    const sentences = parseGloss("[PONTO]");
    expect(buildTimeline(resolveUnits(sentences, catalog), sentences, catalog)).toEqual({
      segments: [],
      expressions: [],
      head: [],
      duration: 0,
    });
  });
});

describe("segmentAt", () => {
  it("acha o segmento ativo e fica no último depois do fim", () => {
    const timeline = planGloss("CASA EU", catalog);
    expect(segmentAt(timeline, 0)?.clip).toBe("CASA");
    expect(segmentAt(timeline, (timeline.segments[1]?.start ?? 0) + 0.01)?.clip).toBe("EU");
    expect(segmentAt(timeline, 100)?.clip).toBe("EU");
  });
});
