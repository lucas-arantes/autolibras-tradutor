import { describe, expect, it } from "vitest";
import {
  defaultSettings,
  ingestUrl,
  newSessionId,
  overlayUrl,
  SessionApi,
  signPackFor,
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
      source: { type: "url", url: "rtmp://x.test/live", realtime: false },
    });
    await expect(api.get("abc")).rejects.toThrow("Limite de sessões");
  });
});
