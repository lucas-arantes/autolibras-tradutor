import { describe, expect, it } from "vitest";
import {
  fingerspellLetters,
  lookupCandidates,
  parseGloss,
  type SignToken,
  tokenize,
} from "./gloss";

function sign(raw: string): SignToken {
  const [token] = tokenize(raw);
  if (token?.kind !== "sign") throw new Error(`não é sinal: ${raw}`);
  return token;
}

describe("tokenize", () => {
  it("separa sinais e marcadores e reconhece os sufixos", () => {
    expect(tokenize("eu  GOSTAR bonito(+) casa&lugar [PONTO]")).toEqual([
      { kind: "sign", raw: "EU", base: "EU", intense: false, negated: false },
      { kind: "sign", raw: "GOSTAR", base: "GOSTAR", intense: false, negated: false },
      { kind: "sign", raw: "BONITO(+)", base: "BONITO", intense: true, negated: false },
      { kind: "sign", raw: "CASA&LUGAR", base: "CASA", intense: false, negated: false },
      { kind: "marker", raw: "[PONTO]", marker: "PONTO" },
    ]);
  });

  it("marca a negação incorporada e o sinal NÃO", () => {
    expect(sign("NÃO_GOSTAR").negated).toBe(true);
    expect(sign("NÃO").negated).toBe(true);
    expect(sign("NOME").negated).toBe(false);
  });

  it("normaliza para NFC (acentos compostos e decompostos são iguais)", () => {
    expect(sign("VOCÊ").base).toBe("VOCÊ");
  });
});

describe("parseGloss", () => {
  it("separa as frases pelos marcadores e classifica cada uma", () => {
    const sentences = parseGloss(
      "OI [EXCLAMAÇÃO] VOCÊ BEM [INTERROGAÇÃO] QUAL SEU NOME [INTERROGAÇÃO] EU CASA",
    );
    expect(sentences.map((s) => [s.type, s.signs.map((t) => t.base).join(" ")])).toEqual([
      ["exclamation", "OI"],
      ["question", "VOCÊ BEM"],
      ["whQuestion", "QUAL SEU NOME"],
      ["statement", "EU CASA"],
    ]);
  });

  it("ignora marcadores sem sinais e glosas vazias", () => {
    expect(parseGloss("[PONTO] [PONTO]")).toEqual([]);
    expect(parseGloss("   ")).toEqual([]);
  });
});

describe("lookupCandidates", () => {
  it("vai do token completo ao sinal mais genérico", () => {
    expect(lookupCandidates(sign("CASA&LUGAR"))).toEqual(["CASA&LUGAR", "CASA"]);
    expect(lookupCandidates(sign("BONITO(+)"))).toEqual(["BONITO(+)", "BONITO"]);
    expect(lookupCandidates(sign("1S_AJUDAR_2S"))).toEqual(["1S_AJUDAR_2S", "AJUDAR"]);
    expect(lookupCandidates(sign("NÃO_GOSTAR"))).toEqual(["NÃO_GOSTAR", "GOSTAR"]);
    expect(lookupCandidates(sign("BOM_DIA"))).toEqual(["BOM_DIA"]);
  });
});

describe("fingerspellLetters", () => {
  it("soletra sem acentos, mantendo o Ç e os dígitos", () => {
    expect(fingerspellLetters("João")).toEqual(["J", "O", "A", "O"]);
    expect(fingerspellLetters("AÇÚCAR")).toEqual(["A", "Ç", "U", "C", "A", "R"]);
    expect(fingerspellLetters("R2-D2")).toEqual(["R", "2", "D", "2"]);
  });
});
