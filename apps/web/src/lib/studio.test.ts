import { describe, expect, it } from "vitest";
import {
  compositionBody,
  defaultSettings,
  feedbackPageUrl,
  ingestUrl,
  newSessionId,
  overlayUrl,
  SessionApi,
  signPackFor,
  textUrl,
} from "./studio";

describe("Estúdio", () => {
  it("gera ids aceitos pelo servidor", () => {
    const id = newSessionId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(newSessionId()).not.toBe(id);
  });

  it("monta o overlay no próprio servidor quando ele serve o app", () => {
    const settings = { ...defaultSettings("http://pc.local:8000", true), sessionId: "abc" };
    const server = { web: true, signs: true };
    expect(overlayUrl(settings, "https://site.test/app/", server, "")).toBe(
      "http://pc.local:8000/broadcast.html?session=abc&avatar=propio" +
        "&signs=http%3A%2F%2Fpc.local%3A8000%2Fsigns%2F",
    );
    expect(overlayUrl({ ...settings, avatar: "guga", caption: true }, "", server, "")).toBe(
      "http://pc.local:8000/broadcast.html?session=abc&avatar=guga&legenda=1",
    );
  });

  it("aponta o overlay publicado para o servidor quando ele não serve o app", () => {
    const settings = { ...defaultSettings("https://site.test", false), sessionId: "abc" };
    expect(settings.server).toBe("http://localhost:8000");
    expect(overlayUrl(settings, "https://site.test/app/", null, "https://cdn.test/BR/")).toBe(
      "https://site.test/app/broadcast.html?session=abc" +
        "&server=http%3A%2F%2Flocalhost%3A8000&avatar=propio",
    );
  });

  it("escolhe o pacote de sinais: o digitado, o do servidor ou o do build", () => {
    const settings = { server: "http://pc.local:8000", signsUrl: "" };
    expect(signPackFor(settings, { signs: true }, "https://cdn.test/BR/")).toBe(
      "http://pc.local:8000/signs/",
    );
    expect(signPackFor(settings, { signs: false }, "https://cdn.test/BR/")).toBe(
      "https://cdn.test/BR/",
    );
    expect(signPackFor({ ...settings, signsUrl: " https://x.test/ " }, null, "")).toBe(
      "https://x.test/",
    );
    expect(signPackFor(settings, null, "")).toBe("");
  });

  it("leva o token na URL do áudio", () => {
    expect(ingestUrl("https://srv.test/base", "abc", "s3")).toBe(
      "wss://srv.test/base/v1/sessions/abc/ingest?token=s3",
    );
    expect(ingestUrl("http://localhost:8000/", "abc", "")).toBe(
      "ws://localhost:8000/v1/sessions/abc/ingest",
    );
  });

  it("cria a sessão com o id fixo e mostra o erro do servidor", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const api = new SessionApi("http://srv.test", "s3", async (url, init) => {
      calls.push({ url: String(url), init });
      return calls.length === 1
        ? new Response(JSON.stringify({ id: "abc", state: "waiting" }), { status: 201 })
        : new Response(JSON.stringify({ detail: "Limite de sessões" }), { status: 400 });
    });
    const settings = { ...defaultSettings("", false), sessionId: "abc", source: "url" as const };
    settings.streamUrl = " rtmp://x.test/live ";
    await expect(api.create(settings)).resolves.toMatchObject({ id: "abc" });
    expect(calls[0]?.url).toBe("http://srv.test/v1/sessions");
    expect(new Headers(calls[0]?.init?.headers).get("Authorization")).toBe("Bearer s3");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      id: "abc",
      source: { type: "url", url: "rtmp://x.test/live", realtime: false, captions: false },
    });
    await expect(api.get("abc")).rejects.toThrow("Limite de sessões");
  });

  it("leva o atraso do modo sincronizado para o overlay", () => {
    const settings = {
      ...defaultSettings("http://pc.local:8000", true),
      sessionId: "abc",
      avatar: "icaro" as const,
      syncDelay: 7,
    };
    expect(overlayUrl(settings, "", { web: true, signs: false }, "")).toBe(
      "http://pc.local:8000/broadcast.html?session=abc&avatar=icaro&atraso=7",
    );
  });

  it("cria sessões de texto e de legenda e envia texto", async () => {
    const bodies: unknown[] = [];
    const urls: string[] = [];
    const api = new SessionApi("http://srv.test", "", async (url, init) => {
      urls.push(String(url));
      bodies.push(JSON.parse(String(init?.body)));
      return new Response("{}", { status: 200 });
    });
    const base = { ...defaultSettings("", false), sessionId: "abc" };
    await api.create({ ...base, source: "text" });
    await api.create({
      ...base,
      source: "url",
      streamUrl: "https://tv.test/a.m3u8",
      captions: true,
    });
    await api.text("abc", "Boa noite.");
    expect(bodies).toEqual([
      { id: "abc", source: { type: "text" } },
      {
        id: "abc",
        source: { type: "url", url: "https://tv.test/a.m3u8", realtime: false, captions: true },
      },
      { text: "Boa noite.", final: true },
    ]);
    expect(urls[2]).toBe(textUrl("http://srv.test", "abc"));
    expect(urls[2]).toBe("http://srv.test/v1/sessions/abc/text");
  });

  it("monta o link do formulário de retorno", () => {
    expect(feedbackPageUrl("http://pc.local:8000", "abc123", "https://site.test/app/", true)).toBe(
      "http://pc.local:8000/feedback.html?f=abc123",
    );
    expect(
      feedbackPageUrl("http://localhost:8000", "abc123", "https://site.test/app/", false),
    ).toBe("https://site.test/app/feedback.html?f=abc123&server=http%3A%2F%2Flocalhost%3A8000");
  });

  it("pede a composição só quando ligada e com fonte de vídeo", () => {
    const base = defaultSettings("", false);
    expect(compositionBody({ ...base, source: "rtmp" })).toBeUndefined();
    const on = {
      ...base.composition,
      enabled: true,
      output: " rtmp://a.rtmp.youtube.test/live2/chave ",
      delay: 10,
    };
    expect(compositionBody({ source: "rtmp", composition: on })).toEqual({
      output: "rtmp://a.rtmp.youtube.test/live2/chave",
      delay: 10,
      position: "right",
      size: 0.5,
      background: "painel",
      caption: true,
      resolution: "1280x720",
    });
    expect(compositionBody({ source: "audio", composition: on })).toBeUndefined();
  });
});
