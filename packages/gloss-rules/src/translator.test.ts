import { describe, expect, it } from "vitest";
import { RulesTranslator, singular, toGloss } from "./translator";
import { lookupVerb } from "./verbs";

describe("toGloss", () => {
  // Frases e glosas de referência do tradutor do VLibras (consultado em 29/10/2026),
  // ajustadas onde o VLibras usa sinais compostos que as regras não conhecem.
  it.each([
    ["Eu estudei ontem na biblioteca.", "EU ESTUDAR ONTEM BIBLIOTECA [PONTO]"],
    ["Eu vou estudar amanhã.", "EU ESTUDAR AMANHÃ [PONTO]"],
    ["Ele não gosta de café.", "ELE NÃO_GOSTAR CAFÉ [PONTO]"],
    ["Onde você mora?", "ONDE VOCÊ MORAR [INTERROGAÇÃO]"],
    ["Os meninos compraram dois livros.", "MENINO COMPRAR 2 LIVRO [PONTO]"],
    ["Ela está cansada hoje.", "ELA CANSADO HOJE [PONTO]"],
    ["Nós trabalhamos muito.", "NÓS TRABALHAR(+) [PONTO]"],
    ["Maria comeu o bolo.", "MARIA COMER BOLO [PONTO]"],
    ["Há muitas pessoas aqui.", "TER MUITO PESSOA AQUI [PONTO]"],
    ["Que legal!", "QUE LEGAL [EXCLAMAÇÃO]"],
    ["Bom dia, tudo bem?", "BOM_DIA TUDO_BEM [INTERROGAÇÃO]"],
    ["Eu trabalho no hospital", "EU TRABALHAR HOSPITAL"],
    ["O trabalho é difícil", "TRABALHO DIFÍCIL"],
    ["Eles não foram à escola", "ELES NÃO_IR ESCOLA"],
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

  it("une a negação ao verbo seguinte", () => {
    expect(toGloss("Eu não entendi a pergunta.")).toBe("EU NÃO_ENTENDER PERGUNTA [PONTO]");
    // O auxiliar omitido não separa a negação do verbo.
    expect(toGloss("Eu não vou estudar.")).toBe("EU NÃO_ESTUDAR [PONTO]");
    expect(toGloss("Ele não quer sair de casa.")).toBe("ELE NÃO_QUERER SAIR CASA [PONTO]");
  });

  it("põe a negação depois de predicados não verbais", () => {
    expect(toGloss("Ela não está cansada.")).toBe("ELA CANSADO NÃO [PONTO]");
    expect(toGloss("Não está muito longe.")).toBe("LONGE(+) NÃO [PONTO]");
    expect(toGloss("Não.")).toBe("NÃO [PONTO]");
  });

  it("marca intensidade com (+)", () => {
    expect(toGloss("Ela é muito bonita.")).toBe("ELA BONITO(+) [PONTO]");
    expect(toGloss("Eu gosto muito de café.")).toBe("EU GOSTAR(+) CAFÉ [PONTO]");
    expect(toGloss("Ele fala muito rápido.")).toBe("ELE FALAR RÁPIDO(+) [PONTO]");
    expect(toGloss("Muito obrigado!")).toBe("MUITO OBRIGADO [EXCLAMAÇÃO]");
    // Plural e feminino quantificam o substantivo, não intensificam.
    expect(toGloss("Ela tem muita paciência.")).toBe("ELA TER MUITO PACIÊNCIA [PONTO]");
  });

  it("reconhece imperativo e subjuntivo", () => {
    expect(toGloss("Fale mais devagar.")).toBe("FALAR MAIS DEVAGAR [PONTO]");
    expect(toGloss("Coma a salada.")).toBe("COMER SALADA [PONTO]");
    expect(toGloss("Abra a porta.")).toBe("ABRIR PORTA [PONTO]");
    expect(toGloss("Fique em casa.")).toBe("FICAR CASA [PONTO]");
    expect(toGloss("Quero que você estude.")).toBe("QUERER VOCÊ ESTUDAR [PONTO]");
  });

  it("não confunde palavras comuns com formas verbais", () => {
    expect(toGloss("Eu não quero nada.")).toBe("EU NÃO_QUERER NADA [PONTO]");
    expect(toGloss("A escola fica entre a praça e o rio.")).toBe(
      "ESCOLA FICAR ENTRE PRAÇA RIO [PONTO]",
    );
    expect(toGloss("A mala é leve.")).toBe("MALA LEVE [PONTO]");
    expect(toGloss("Ela fez uma escolha difícil.")).toBe("ELA FAZER ESCOLHA DIFÍCIL [PONTO]");
  });

  it("traduz expressões com sinal próprio", () => {
    expect(toGloss("Quantos anos você tem?")).toBe("QUANTO IDADE VOCÊ TER [INTERROGAÇÃO]");
    expect(toGloss("Vocês moram aqui há quanto tempo?")).toBe(
      "VOCÊS MORAR AQUI QUANTO TEMPO [INTERROGAÇÃO]",
    );
    expect(toGloss("Ligue mais tarde.")).toBe("LIGAR DEPOIS [PONTO]");
    expect(toGloss("Vou viajar no fim de semana.")).toBe("VIAJAR FIM_SEMANA [PONTO]");
    // Expressões não recebem a intensidade de "muito"; ela vai para o verbo.
    expect(toGloss("Ele trabalha muito todos os dias.")).toBe("ELE TRABALHAR(+) TODO_DIA [PONTO]");
  });

  it("une palavras compostas com _", () => {
    expect(toGloss("Ele esqueceu o guarda-chuva.")).toBe("ELE ESQUECER GUARDA_CHUVA [PONTO]");
  });

  it("acrescenta HORA a horários sem a palavra", () => {
    expect(toGloss("O mercado abre às oito.")).toBe("MERCADO ABRIR 8 HORA [PONTO]");
    expect(toGloss("A aula começa às nove horas.")).toBe("AULA COMEÇAR 9 HORA [PONTO]");
  });

  it("usa a forma masculina de substantivos de papel e mantém LIBRAS", () => {
    expect(toGloss("A professora ensina libras.")).toBe("PROFESSOR ENSINAR LIBRAS [PONTO]");
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
