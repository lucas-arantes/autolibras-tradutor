// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { injectOverlay, removeOverlay } from "./inject";
import { DEFAULT_SETTINGS, normalizeSettings, playerSrc } from "./settings";

describe("normalizeSettings", () => {
  it("completa com o padrão o que faltar ou for inválido", () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(
      normalizeSettings({
        serverUrl: "http://servidor.example",
        translator: "outro",
        avatar: "ninguém",
        playerUrl: "javascript:alert(1)",
      }),
    ).toEqual(DEFAULT_SETTINGS);
  });

  it("aceita valores válidos", () => {
    const settings = normalizeSettings({
      serverUrl: "wss://stt.example/v1/stream",
      translator: "regras",
      avatar: "hosana",
      playerUrl: "http://localhost:4173/player.html",
    });
    expect(settings).toEqual({
      serverUrl: "wss://stt.example/v1/stream",
      translator: "regras",
      avatar: "hosana",
      playerUrl: "http://localhost:4173/player.html",
    });
  });

  it("só aceita player em HTTP quando é local", () => {
    expect(normalizeSettings({ playerUrl: "http://site.example/player.html" }).playerUrl).toBe(
      DEFAULT_SETTINGS.playerUrl,
    );
  });

  it("monta o endereço do player com tradutor e avatar", () => {
    const src = new URL(playerSrc({ ...DEFAULT_SETTINGS, translator: "regras", avatar: "guga" }));
    expect(src.searchParams.get("translator")).toBe("regras");
    expect(src.searchParams.get("avatar")).toBe("guga");
  });
});

describe("injectOverlay", () => {
  const origin = "chrome-extension://abc";

  afterEach(() => removeOverlay());

  const frame = () => document.getElementById("autolibras-overlay") as HTMLIFrameElement | null;

  it("cria um único overlay fixo no canto inferior direito", () => {
    injectOverlay(`${origin}/overlay.html?tab=1`, origin);
    injectOverlay(`${origin}/overlay.html?tab=1`, origin);
    expect(document.querySelectorAll("#autolibras-overlay")).toHaveLength(1);
    expect(frame()?.style.position).toBe("fixed");
    expect(frame()?.style.bottom).toBe("16px");
    expect(frame()?.style.right).toBe("16px");
  });

  it("muda de canto só a pedido do próprio overlay", () => {
    injectOverlay(`${origin}/overlay.html?tab=1`, origin);
    const source = frame()?.contentWindow ?? null;
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "autolibras:move" },
        origin: "https://site.example",
        source,
      }),
    );
    expect(frame()?.style.right).toBe("16px");
    window.dispatchEvent(
      new MessageEvent("message", { data: { type: "autolibras:move" }, origin, source }),
    );
    expect(frame()?.style.left).toBe("16px");
    expect(frame()?.style.right).toBe("auto");
  });

  it("removeOverlay tira o overlay da página", () => {
    injectOverlay(`${origin}/overlay.html?tab=1`, origin);
    removeOverlay();
    expect(frame()).toBeNull();
  });
});
