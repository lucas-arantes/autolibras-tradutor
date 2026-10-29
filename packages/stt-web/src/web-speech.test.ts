import type { RecognizerState, TranscriptSegment } from "@autolibras/core";
import { describe, expect, it } from "vitest";
import { type SpeechRecognitionLike, WebSpeechRecognizer } from "./web-speech";

const instances: FakeRecognition[] = [];

class FakeRecognition implements SpeechRecognitionLike {
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  onstart: SpeechRecognitionLike["onstart"] = null;
  onresult: SpeechRecognitionLike["onresult"] = null;
  onerror: SpeechRecognitionLike["onerror"] = null;
  onend: SpeechRecognitionLike["onend"] = null;
  started = false;

  constructor() {
    instances.push(this);
  }
  start() {
    this.started = true;
    this.onstart?.();
  }
  stop() {
    this.onend?.();
  }
  abort() {
    this.onend?.();
  }
  result(index: number, text: string, isFinal: boolean) {
    const results = [];
    results[index] = Object.assign([{ transcript: text }], { isFinal });
    this.onresult?.({ resultIndex: index, results });
  }
}

function setup() {
  instances.length = 0;
  const recognizer = new WebSpeechRecognizer({ recognition: FakeRecognition, restartDelayMs: 0 });
  const transcripts: TranscriptSegment[] = [];
  const states: RecognizerState[] = [];
  const errors: string[] = [];
  recognizer.on("transcript", (t) => transcripts.push(t));
  recognizer.on("state", (s) => states.push(s));
  recognizer.on("error", (e) => errors.push(e.message));
  return { recognizer, transcripts, states, errors };
}

describe("WebSpeechRecognizer", () => {
  it("configura pt-BR contínuo com resultados parciais", () => {
    const { recognizer, states } = setup();
    recognizer.start();
    expect(instances[0]).toMatchObject({ lang: "pt-BR", continuous: true, interimResults: true });
    expect(states).toEqual(["listening"]);
  });

  it("emite parciais e finais com o mesmo id", () => {
    const { recognizer, transcripts } = setup();
    recognizer.start();
    instances[0]?.result(0, "bom ", false);
    instances[0]?.result(0, "bom dia", true);
    expect(transcripts.map((t) => [t.id, t.text, t.isFinal])).toEqual([
      ["fala-1-0", "bom", false],
      ["fala-1-0", "bom dia", true],
    ]);
  });

  it("religa quando o navegador encerra a sessão sozinho", async () => {
    const { recognizer } = setup();
    recognizer.start();
    instances[0]?.onend?.();
    await new Promise((r) => setTimeout(r, 5));
    expect(instances).toHaveLength(2);
    expect(instances[1]?.started).toBe(true);
  });

  it("para sem religar ao chamar stop", async () => {
    const { recognizer, states } = setup();
    recognizer.start();
    recognizer.stop();
    await new Promise((r) => setTimeout(r, 5));
    expect(instances).toHaveLength(1);
    expect(states).toEqual(["listening", "idle"]);
  });

  it("encerra em erros fatais e ignora silêncio", () => {
    const { recognizer, errors, states } = setup();
    recognizer.start();
    instances[0]?.onerror?.({ error: "no-speech" });
    expect(errors).toEqual([]);
    instances[0]?.onerror?.({ error: "not-allowed" });
    expect(errors).toEqual(["Permissão de microfone negada."]);
    expect(states.at(-1)).toBe("error");
    expect(recognizer.active).toBe(false);
  });

  it("avisa quando o navegador não tem a API", () => {
    const recognizer = new WebSpeechRecognizer({ recognition: undefined });
    const errors: string[] = [];
    recognizer.on("error", (e) => errors.push(e.message));
    recognizer.start();
    expect(errors[0]).toContain("Web Speech API");
  });
});
