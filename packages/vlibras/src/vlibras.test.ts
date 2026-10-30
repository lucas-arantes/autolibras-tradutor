// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { VLibrasApiTranslator } from "./api-translator";
import { shieldFromTextCapture } from "./text-capture-shield";
import { loadVLibrasVocabulary } from "./vocabulary";
import { type VLibrasGlobal, type VLibrasStatus, VLibrasWidgetRenderer } from "./widget-renderer";

describe("VLibrasApiTranslator", () => {
  it("envia o texto e devolve a glosa", async () => {
    const requests: unknown[] = [];
    const translator = new VLibrasApiTranslator({
      url: "https://exemplo.test/translate",
      fetch: async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)));
        return new Response("EU ESTUDAR [PONTO]\n");
      },
    });
    expect(await translator.translate("Eu estudo.")).toEqual({
      gloss: "EU ESTUDAR [PONTO]",
      source: "vlibras",
    });
    expect(requests).toEqual([{ text: "Eu estudo." }]);
  });

  it("lê a glosa quando a API responde em JSON", async () => {
    // Resposta real do endpoint para "Qual é o seu nome?" (29/10/2026).
    const body =
      '{"traducao":"QUAL SEU NOME [INTERROGAÇÃO]","sentimentoGeral":"ERRO_API_GERAL","sentimentoPorSentenca":[]}';
    const translator = new VLibrasApiTranslator({ fetch: async () => new Response(body) });
    expect((await translator.translate("Qual é o seu nome?")).gloss).toBe(
      "QUAL SEU NOME [INTERROGAÇÃO]",
    );
    const unknown = new VLibrasApiTranslator({ fetch: async () => new Response('{"erro":1}') });
    await expect(unknown.translate("oi")).rejects.toThrow("formato inesperado");
  });

  it("falha com status de erro ou glosa vazia", async () => {
    const error = new VLibrasApiTranslator({
      fetch: async () => new Response("", { status: 503 }),
    });
    await expect(error.translate("oi")).rejects.toThrow("503");
    const empty = new VLibrasApiTranslator({ fetch: async () => new Response("  ") });
    await expect(empty.translate("oi")).rejects.toThrow("vazia");
  });
});

/** Simula o `window.vlibras` publicado pelo Widget. */
function fakePlayer(): VLibrasGlobal & { calls: string[]; setStatus(s: VLibrasStatus): void } {
  const player = {
    status: "idle" as VLibrasStatus,
    calls: [] as string[],
    play(gloss?: string) {
      player.calls.push(`play:${gloss}`);
    },
    stop() {
      player.calls.push("stop");
    },
    setSpeed(speed: number) {
      player.calls.push(`speed:${speed}`);
    },
    setStatus(status: VLibrasStatus) {
      player.status = status;
    },
  };
  return player;
}

describe("VLibrasWidgetRenderer", () => {
  afterEach(() => {
    window.vlibras = undefined;
  });

  it("toca a glosa e resolve quando o player volta a ficar parado", async () => {
    const player = fakePlayer();
    window.vlibras = player;
    const renderer = new VLibrasWidgetRenderer({ pollMs: 5 });
    await renderer.load();

    let done = false;
    const playing = renderer.play("OI").then(() => {
      done = true;
    });
    expect(player.calls).toEqual(["play:OI"]);
    player.setStatus("playing");
    await new Promise((r) => setTimeout(r, 20));
    expect(done).toBe(false);
    player.setStatus("idle");
    await playing;
    expect(done).toBe(true);
  });

  it("desiste se o sinal não começar no tempo limite", async () => {
    window.vlibras = fakePlayer();
    const renderer = new VLibrasWidgetRenderer({ pollMs: 5, startTimeoutMs: 20 });
    await expect(renderer.play("OI")).resolves.toBeUndefined();
  });

  it("stop libera o play em andamento", async () => {
    const player = fakePlayer();
    window.vlibras = player;
    const renderer = new VLibrasWidgetRenderer({ pollMs: 5 });
    const playing = renderer.play("OI");
    player.setStatus("playing");
    await new Promise((r) => setTimeout(r, 10));
    renderer.stop();
    await playing;
    expect(player.calls).toEqual(["play:OI", "stop"]);
  });

  it("falha ao tocar sem player carregado", async () => {
    await expect(new VLibrasWidgetRenderer().play("OI")).rejects.toThrow("não carregado");
  });
});

describe("shieldFromTextCapture", () => {
  it("marca cliques dentro do elemento antes da captura em document.body", () => {
    const app = document.createElement("div");
    const button = document.createElement("button");
    app.append(button);
    const outside = document.createElement("p");
    document.body.append(app, outside);

    const seen: boolean[] = [];
    const widgetCapture = (event: Event) =>
      seen.push(Boolean((event as unknown as Record<string, unknown>).__vlibrasSyntheticClick));
    document.body.addEventListener("click", widgetCapture, true);
    const release = shieldFromTextCapture(app);

    button.click();
    outside.click();
    expect(seen).toEqual([true, false]);

    release();
    button.click();
    expect(seen).toEqual([true, false, false]);
    document.body.removeEventListener("click", widgetCapture, true);
  });

  it("impede que o hover chegue ao document.body", () => {
    const app = document.createElement("div");
    document.body.append(app);
    let reached = 0;
    document.body.addEventListener("mouseover", () => reached++);
    shieldFromTextCapture(app);
    app.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(reached).toBe(0);
  });
});

describe("loadVLibrasVocabulary", () => {
  const trie = {
    root: {
      children: {
        C: {
          children: {
            A: {
              children: {
                S: {
                  children: {
                    A: { end: true, children: { R: { end: true, children: {} } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  };

  it("lê a árvore de prefixos e guarda no armazenamento local", async () => {
    const stored = new Map<string, string>();
    const storage = {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
    };
    let requests = 0;
    const fetchFn = async () => {
      requests++;
      return new Response(JSON.stringify(trie));
    };
    const first = await loadVLibrasVocabulary({ fetch: fetchFn, storage });
    expect([...first].sort()).toEqual(["CASA", "CASAR"]);
    const second = await loadVLibrasVocabulary({ fetch: fetchFn, storage });
    expect(second).toEqual(first);
    expect(requests).toBe(1);
  });

  it("falha quando o servidor responde com erro", async () => {
    const fetchFn = async () => new Response("", { status: 503 });
    await expect(loadVLibrasVocabulary({ fetch: fetchFn, storage: null })).rejects.toThrow("503");
  });
});
