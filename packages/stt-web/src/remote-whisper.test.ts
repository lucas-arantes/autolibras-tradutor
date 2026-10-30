import type { RecognizerState, TranscriptSegment } from "@autolibras/core";
import { describe, expect, it } from "vitest";
import { type AudioCapture, RemoteWhisperRecognizer, type SocketLike } from "./remote-whisper";

class FakeSocket implements SocketLike {
  binaryType = "blob";
  readyState = 0;
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onerror: SocketLike["onerror"] = null;
  onclose: SocketLike["onclose"] = null;
  readonly sent: Array<string | ArrayBufferLike> = [];
  closed = false;

  constructor(readonly url: string) {}
  send(data: string | ArrayBufferLike) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(captureError?: Error) {
  const sockets: FakeSocket[] = [];
  let feed: ((samples: Float32Array) => void) | undefined;
  let stopped = 0;
  const recognizer = new RemoteWhisperRecognizer({
    url: "ws://servidor.test/v1/stream",
    connect: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    captureAudio: async (onSamples): Promise<AudioCapture> => {
      if (captureError) throw captureError;
      feed = onSamples;
      return { sampleRate: 48_000, stop: () => stopped++ };
    },
  });
  const transcripts: TranscriptSegment[] = [];
  const states: RecognizerState[] = [];
  const errors: string[] = [];
  recognizer.on("transcript", (t) => transcripts.push(t));
  recognizer.on("state", (s) => states.push(s));
  recognizer.on("error", (e) => errors.push(e.message));
  return {
    recognizer,
    sockets,
    transcripts,
    states,
    errors,
    feed: (s: Float32Array) => feed?.(s),
    stopped: () => stopped,
  };
}

describe("RemoteWhisperRecognizer", () => {
  it("envia o áudio do microfone em blocos PCM de 16 kHz", async () => {
    const t = setup();
    t.recognizer.start();
    t.sockets[0]?.open();
    await flush();
    expect(t.states).toEqual(["listening"]);
    // 100 ms a 48 kHz = 4800 amostras → 1600 amostras PCM16 = 3200 bytes.
    for (let i = 0; i < 4800; i += 128) t.feed(new Float32Array(128));
    const audio = t.sockets[0]?.sent.filter((d) => typeof d !== "string") as ArrayBuffer[];
    expect(audio).toHaveLength(1);
    expect(audio[0]?.byteLength).toBeGreaterThanOrEqual(3200);
  });

  it("converte parciais e finais do servidor em transcrições", async () => {
    const t = setup();
    t.recognizer.start();
    t.sockets[0]?.open();
    await flush();
    t.sockets[0]?.receive({ type: "ready", model: "small" });
    t.sockets[0]?.receive({ type: "partial", id: "s1", text: "bom", stable: "" });
    t.sockets[0]?.receive({ type: "final", id: "s1", text: "Bom dia.", start: 0, end: 1 });
    t.sockets[0]?.receive({ type: "final", id: "s2", text: "", start: 1, end: 2 });
    expect(t.transcripts.map((x) => [x.id, x.text, x.isFinal])).toEqual([
      ["whisper-1-s1", "bom", false],
      ["whisper-1-s1", "Bom dia.", true],
      // Final vazio só limpa a legenda: não vira frase para traduzir.
      ["whisper-1-s2", "", false],
    ]);
  });

  it("stop pede ao servidor o fim da transcrição e libera o microfone", async () => {
    const t = setup();
    t.recognizer.start();
    t.sockets[0]?.open();
    await flush();
    t.recognizer.stop();
    expect(t.sockets[0]?.sent.at(-1)).toBe(JSON.stringify({ type: "stop" }));
    expect(t.stopped()).toBe(1);
    expect(t.states.at(-1)).toBe("idle");
    // A frase final que chega depois do stop ainda é entregue.
    t.sockets[0]?.receive({ type: "final", id: "s1", text: "Até logo.", start: 0, end: 1 });
    expect(t.transcripts.at(-1)?.isFinal).toBe(true);
    t.sockets[0]?.receive({ type: "stopped" });
    expect(t.sockets[0]?.closed).toBe(true);
    expect(t.errors).toEqual([]);
  });

  it("avisa quando não consegue conectar", () => {
    const t = setup();
    t.recognizer.start();
    t.sockets[0]?.onerror?.();
    expect(t.errors[0]).toContain("ws://servidor.test/v1/stream");
    expect(t.states).toEqual(["error"]);
    expect(t.recognizer.active).toBe(false);
  });

  it("avisa quando a conexão cai durante a escuta", async () => {
    const t = setup();
    t.recognizer.start();
    t.sockets[0]?.open();
    await flush();
    t.sockets[0]?.close();
    expect(t.errors).toEqual(["A conexão com o servidor de transcrição caiu."]);
    expect(t.stopped()).toBe(1);
  });

  it("explica quando o microfone é negado", async () => {
    const denied = Object.assign(new Error("negado"), { name: "NotAllowedError" });
    const t = setup(denied);
    t.recognizer.start();
    t.sockets[0]?.open();
    await flush();
    expect(t.errors).toEqual(["Permissão de microfone negada."]);
    expect(t.sockets[0]?.closed).toBe(true);
  });

  it("repassa erros do servidor", async () => {
    const t = setup();
    t.recognizer.start();
    t.sockets[0]?.open();
    await flush();
    t.sockets[0]?.receive({ type: "error", message: "Áudio inválido" });
    expect(t.errors).toEqual(["Servidor de transcrição: Áudio inválido"]);
  });
});
