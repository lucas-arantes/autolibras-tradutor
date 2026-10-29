import { describe, expect, it } from "vitest";
import { Emitter } from "./emitter";
import { FallbackTranslator } from "./fallback-translator";
import { type GlossEntry, Pipeline } from "./pipeline";
import { FakeRenderer, flush } from "./test-utils";
import type { GlossTranslator, SpeechRecognizer, SpeechRecognizerEvents } from "./types";

const upper: GlossTranslator = {
  name: "upper",
  translate: async (text) => ({ gloss: text.toUpperCase(), source: "upper" }),
};

const failing: GlossTranslator = {
  name: "falha",
  translate: async () => {
    throw new Error("serviço fora do ar");
  },
};

const hanging: GlossTranslator = {
  name: "trava",
  translate: () => new Promise(() => {}),
};

class FakeRecognizer extends Emitter<SpeechRecognizerEvents> implements SpeechRecognizer {
  readonly name = "fake";
  start() {}
  stop() {}
  say(id: string, text: string, isFinal: boolean) {
    this.emit("transcript", { id, text, isFinal, timestamp: 0 });
  }
}

describe("Pipeline", () => {
  it("traduz só transcrições finais e enfileira na ordem da fala", async () => {
    const renderer = new FakeRenderer();
    const slowFirst: GlossTranslator = {
      name: "lento",
      translate: (text) =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ gloss: text.toUpperCase(), source: "lento" }),
            text === "um" ? 20 : 0,
          ),
        ),
    };
    const pipeline = new Pipeline({ translator: slowFirst, renderer });
    const recognizer = new FakeRecognizer();
    const glosses: GlossEntry[] = [];
    pipeline.on("gloss", (g) => glosses.push(g));
    pipeline.attach(recognizer);

    recognizer.say("1", "u", false);
    recognizer.say("1", "um", true);
    recognizer.say("2", "dois", true);
    await new Promise((r) => setTimeout(r, 40));
    await pipeline.idle();

    expect(glosses.map((g) => g.gloss)).toEqual(["UM", "DOIS"]);
    expect(renderer.played).toEqual(["UM"]);
    await renderer.finish();
    expect(renderer.played).toEqual(["UM", "DOIS"]);
  });

  it("submitText traduz texto digitado", async () => {
    const renderer = new FakeRenderer();
    const pipeline = new Pipeline({ translator: upper, renderer });
    expect(pipeline.submitText("   ")).toBeUndefined();
    pipeline.submitText(" olá ");
    await pipeline.idle();
    await flush();
    expect(renderer.played).toEqual(["OLÁ"]);
  });

  it("reporta erro de tradução sem travar as próximas", async () => {
    const renderer = new FakeRenderer();
    const pipeline = new Pipeline({ translator: failing, renderer });
    const errors: string[] = [];
    pipeline.on("error", (e) => errors.push(`${e.source}: ${e.error.message}`));
    pipeline.submitText("a");
    await pipeline.idle();
    pipeline.translator = upper;
    pipeline.submitText("b");
    await pipeline.idle();
    await flush();
    expect(errors).toEqual(["translator: serviço fora do ar"]);
    expect(renderer.played).toEqual(["B"]);
  });
});

describe("FallbackTranslator", () => {
  it("cai para o próximo tradutor em caso de erro", async () => {
    const translator = new FallbackTranslator([failing, upper]);
    expect(await translator.translate("oi")).toEqual({ gloss: "OI", source: "upper" });
  });

  it("cai para o próximo tradutor quando o tempo limite estoura", async () => {
    const translator = new FallbackTranslator([hanging, upper], 10);
    expect(await translator.translate("oi")).toEqual({ gloss: "OI", source: "upper" });
  });

  it("propaga o último erro se todos falharem", async () => {
    const translator = new FallbackTranslator([failing]);
    await expect(translator.translate("oi")).rejects.toThrow("serviço fora do ar");
  });
});
