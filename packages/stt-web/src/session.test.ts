import type { RecognizerState, TranscriptSegment } from "@autolibras/core";
import { describe, expect, it } from "vitest";
import type { SocketLike } from "./remote-whisper";
import { SessionRecognizer, type SessionStatus, sessionEventsUrl } from "./session";

class FakeSocket implements SocketLike {
  binaryType = "blob";
  readyState = 0;
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onerror: SocketLike["onerror"] = null;
  onclose: SocketLike["onclose"] = null;
  closed = false;

  constructor(readonly url: string) {}
  send() {}
  close(code = 1006) {
    this.closed = true;
    this.onclose?.({ code });
  }
  receive(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function setup() {
  const sockets: FakeSocket[] = [];
  const timers: Array<{ callback: () => void; ms: number; cleared: boolean }> = [];
  const recognizer = new SessionRecognizer({
    server: "http://servidor.test:8000",
    sessionId: "abc",
    connect: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    retryDelays: [100, 200],
    setTimer: (callback, ms) => {
      const timer = { callback, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      (timer as { cleared: boolean }).cleared = true;
    },
  });
  const transcripts: TranscriptSegment[] = [];
  const states: RecognizerState[] = [];
  const sessions: SessionStatus[] = [];
  recognizer.on("transcript", (t) => transcripts.push(t));
  recognizer.on("state", (s) => states.push(s));
  recognizer.on("session", (s) => sessions.push(s));
  return { recognizer, sockets, timers, transcripts, states, sessions };
}

describe("sessionEventsUrl", () => {
  it("troca http por ws e https por wss", () => {
    expect(sessionEventsUrl("http://localhost:8000", "x")).toBe(
      "ws://localhost:8000/v1/sessions/x/events",
    );
    expect(sessionEventsUrl("https://exemplo.test/autolibras/", "a b")).toBe(
      "wss://exemplo.test/autolibras/v1/sessions/a%20b/events",
    );
  });
});

describe("SessionRecognizer", () => {
  it("repassa parciais e finais da sessão", () => {
    const { recognizer, sockets, transcripts, states, sessions } = setup();
    recognizer.start();
    expect(sockets[0]?.url).toBe("ws://servidor.test:8000/v1/sessions/abc/events");
    sockets[0]?.receive({ type: "session", id: "abc", state: "waiting", error: null });
    sockets[0]?.receive({ type: "state", state: "live", error: null });
    sockets[0]?.receive({ type: "partial", id: "s1", text: "bom", stable: "" });
    sockets[0]?.receive({ type: "final", id: "s1", text: "bom dia", start: 0, end: 1 });
    sockets[0]?.receive({ type: "final", id: "s2", text: "  ", start: 1, end: 2 });
    expect(states).toEqual(["listening"]);
    expect(sessions.map((s) => s.state)).toEqual(["connecting", "waiting", "live"]);
    expect(transcripts.map((t) => [t.id, t.text, t.isFinal])).toEqual([
      ["sessao-1-s1", "bom", false],
      ["sessao-1-s1", "bom dia", true],
      ["sessao-1-s2", "  ", false],
    ]);
  });

  it("reconecta quando a conexão cai, com espera crescente", () => {
    const { recognizer, sockets, timers, sessions } = setup();
    recognizer.start();
    sockets[0]?.close();
    expect(sessions.at(-1)?.state).toBe("offline");
    expect(timers.map((t) => t.ms)).toEqual([100]);
    timers[0]?.callback();
    sockets[1]?.close();
    timers[1]?.callback();
    sockets[2]?.close();
    expect(timers.map((t) => t.ms)).toEqual([100, 200, 200]);
    timers[2]?.callback();
    // Conectou: a espera volta ao início.
    sockets[3]?.receive({ type: "session", state: "live", error: null });
    sockets[3]?.close();
    expect(timers.at(-1)?.ms).toBe(100);
    expect(sockets).toHaveLength(4);
  });

  it("diz se a sessão ainda não existe ou foi encerrada", () => {
    const { recognizer, sockets, timers, sessions } = setup();
    recognizer.start();
    sockets[0]?.close(1008);
    expect(sessions.at(-1)?.state).toBe("missing");
    timers[0]?.callback();
    sockets[1]?.close(1008);
    // Enquanto a sessão não existe, a espera não cresce.
    expect(timers.map((t) => t.ms)).toEqual([100, 100]);
    timers[1]?.callback();
    sockets[2]?.receive({ type: "session", state: "live", error: null });
    sockets[2]?.receive({ type: "state", state: "ended", error: null });
    sockets[2]?.close(1000);
    expect(sessions.at(-1)?.state).toBe("ended");
    expect(timers).toHaveLength(3);
  });

  it("stop fecha a conexão e cancela a reconexão", () => {
    const { recognizer, sockets, timers, states } = setup();
    recognizer.start();
    sockets[0]?.close();
    recognizer.stop();
    expect(timers[0]?.cleared).toBe(true);
    timers[0]?.callback();
    expect(sockets).toHaveLength(1);
    expect(states).toEqual(["idle"]);

    recognizer.start();
    recognizer.stop();
    expect(sockets[1]?.closed).toBe(true);
    expect(timers).toHaveLength(1);
  });
});

describe("SessionRecognizer no modo sincronizado", () => {
  it("marca cada frase para o horário da fala mais o atraso, no relógio da fila", () => {
    const sockets: FakeSocket[] = [];
    let epoch = 5_000;
    const recognizer = new SessionRecognizer({
      server: "http://servidor.test",
      sessionId: "abc",
      connect: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
      delaySeconds: 8,
      // O relógio deste computador está 2 s adiantado em relação ao do servidor.
      epochNow: () => epoch,
      queueNow: () => epoch - 4_000,
    });
    const transcripts: TranscriptSegment[] = [];
    recognizer.on("transcript", (t) => transcripts.push(t));
    recognizer.start();
    // Chega com 0,3 s de rede: a estimativa fica em 2,3 s de diferença...
    sockets[0]?.receive({ type: "session", state: "live", error: null, serverTime: 4_997.7 });
    // ...e cai para 2,05 quando uma mensagem chega mais rápido.
    epoch = 5_010;
    sockets[0]?.receive({
      type: "final",
      id: "s1",
      text: "Bom dia.",
      wallStart: 5_004,
      serverTime: 5_007.95,
    });
    // Fala em 5004 (servidor) = 5006,05 (local); +8 s = 5014,05 → fila: 1014,05.
    expect(transcripts[0]?.playAt).toBeCloseTo(1_014.05, 5);
  });

  it("sem atraso, não marca horário", () => {
    const { recognizer, sockets, transcripts } = setup();
    recognizer.start();
    sockets[0]?.receive({ type: "final", id: "s1", text: "Oi", wallStart: 1, serverTime: 2 });
    expect(transcripts[0]?.playAt).toBeUndefined();
  });
});
