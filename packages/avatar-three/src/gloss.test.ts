import { describe, expect, it } from "vitest";
import {
  fingerspellLetters,
  isLetterToken,
  lookupCandidates,
  numberSigns,
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

describe("isLetterToken", () => {
  it("reconhece letras soltas, sem sufixos", () => {
    expect(isLetterToken(sign("A"))).toBe(true);
    expect(isLetterToken(sign("ç"))).toBe(true);
    expect(isLetterToken(sign("EU"))).toBe(false);
    expect(isLetterToken(sign("A(+)"))).toBe(false);
    expect(isLetterToken(sign("1"))).toBe(false);
  });
});

describe("numberSigns", () => {
  it("vai algarismo por algarismo até quatro dígitos", () => {
    expect(numberSigns("8")).toEqual(["8"]);
    expect(numberSigns("25")).toEqual(["2", "5"]);
    expect(numberSigns("2010")).toEqual(["2", "0", "1", "0"]);
  });

  it("usa MIL e MILHÃO a partir de cinco dígitos e pula grupos zerados", () => {
    expect(numberSigns("25000")).toEqual(["2", "5", "MIL"]);
    expect(numberSigns("1.500.000")).toEqual(["1", "MILHÃO", "5", "0", "0", "MIL"]);
    expect(numberSigns("2000300")).toEqual(["2", "MILHÃO", "3", "0", "0"]);
    expect(numberSigns("00000")).toEqual(["0"]);
  });

  it("lê a parte decimal depois de VÍRGULA", () => {
    expect(numberSigns("3,75")).toEqual(["3", "VÍRGULA", "7", "5"]);
  });

  it("devolve null para o que não é número", () => {
    expect(numberSigns("CASA")).toBeNull();
    expect(numberSigns("1S_IR_2S")).toBeNull();
    expect(numberSigns("1.5.")).toBeNull();
  });
});
