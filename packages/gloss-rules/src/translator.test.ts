import { describe, expect, it } from "vitest";
import { RulesTranslator, singular, toGloss } from "./translator";
import { lookupVerb } from "./verbs";

describe("toGloss", () => {
  // Frases e glosas de referência do tradutor do VLibras (consultado em 29/10/2026),
  // ajustadas onde o VLibras usa sinais compostos que as regras não conhecem.
  it.each([
    ["Eu estudei ontem na biblioteca.", "EU ESTUDAR ONTEM BIBLIOTECA [PONTO]"],
    ["Eu vou estudar amanhã.", "EU ESTUDAR AMANHÃ [PONTO]"],
    ["Ele não gosta de café.", "ELE NÃO GOSTAR CAFÉ [PONTO]"],
    ["Onde você mora?", "ONDE VOCÊ MORAR [INTERROGAÇÃO]"],
    ["Os meninos compraram dois livros.", "MENINO COMPRAR 2 LIVRO [PONTO]"],
    ["Ela está cansada hoje.", "ELA CANSADO HOJE [PONTO]"],
    ["Nós trabalhamos muito.", "NÓS TRABALHAR MUITO [PONTO]"],
    ["Maria comeu o bolo.", "MARIA COMER BOLO [PONTO]"],
    ["Há muitas pessoas aqui.", "TER MUITO PESSOA AQUI [PONTO]"],
    ["Que legal!", "QUE LEGAL [EXCLAMAÇÃO]"],
    ["Bom dia, tudo bem?", "BOM_DIA TUDO_BEM [INTERROGAÇÃO]"],
    ["Eu trabalho no hospital", "EU TRABALHAR HOSPITAL"],
    ["O trabalho é difícil", "TRABALHO DIFÍCIL"],
    ["Eles não foram à escola", "ELES NÃO IR ESCOLA"],
    ["As flores são bonitas", "FLOR BONITO"],
    ["Eu conheço três pessoas", "EU CONHECER 3 PESSOA"],
    ["Ele estava dormindo", "ELE DORMIR"],
  ])("%s", (text, gloss) => {
    expect(toGloss(text)).toBe(gloss);
  });

  it("separa frases e mantém o marcador de cada uma", () => {
    expect(toGloss("Eu fiquei em casa. Amanhã vou trabalhar!")).toBe(
      "EU FICAR CASA [PONTO] AMANHÃ TRABALHAR [EXCLAMAÇÃO]",
    );
  });

  it("compõe números por extenso", () => {
    expect(toGloss("Tenho vinte e cinco anos.")).toBe("TER 25 ANO [PONTO]");
    expect(toGloss("Moro em São Paulo desde 2010")).toBe("MORAR SÃO_PAULO DESDE 2010");
  });

  it("usa IR quando 'foi' indica deslocamento e omite quando é cópula", () => {
    expect(toGloss("Ele foi ao mercado")).toBe("ELE IR MERCADO");
    expect(toGloss("Ele foi rápido")).toBe("ELE RÁPIDO");
  });

  it("devolve vazio para texto sem palavras", () => {
    expect(toGloss("  ... ")).toBe("");
  });
});

describe("singular", () => {
  it.each([
    ["meninos", "menino"],
    ["flores", "flor"],
    ["vezes", "vez"],
    ["homens", "homem"],
    ["animais", "animal"],
    ["corações", "coração"],
    ["irmãs", "irmã"],
    ["meses", "mês"],
    ["ônibus", "ônibus"],
    ["três", "três"],
    ["depois", "depois"],
  ])("%s → %s", (plural, expected) => {
    expect(singular(plural)).toBe(expected);
  });
});

describe("lookupVerb", () => {
  it("ajusta a grafia do radical", () => {
    expect(lookupVerb("fiquei")?.lemma).toBe("ficar");
    expect(lookupVerb("paguei")?.lemma).toBe("pagar");
    expect(lookupVerb("comecei")?.lemma).toBe("começar");
    expect(lookupVerb("conheço")?.lemma).toBe("conhecer");
    expect(lookupVerb("conhece")?.lemma).toBe("conhecer");
    expect(lookupVerb("dirijo")?.lemma).toBe("dirigir");
  });

  it("não trata substantivos frequentes como verbos", () => {
    expect(lookupVerb("casa")).toBeUndefined();
    expect(lookupVerb("como")).toBeUndefined();
  });
});

describe("RulesTranslator", () => {
  it("identifica a fonte", async () => {
    expect(await new RulesTranslator().translate("Oi")).toEqual({ gloss: "OI", source: "regras" });
  });
});
