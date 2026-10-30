// @vitest-environment jsdom
import type { AvatarRenderer } from "@autolibras/core";
import { describe, expect, it, vi } from "vitest";
import { attachClosedSigning } from "./closed-signing";

const renderer: AvatarRenderer = {
  name: "falso",
  load: async () => undefined,
  play: async () => undefined,
  stop: () => undefined,
  setSpeed: () => undefined,
};

function setup(feedbackUrl?: string) {
  const box = document.createElement("div");
  const video = document.createElement("video");
  box.append(video);
  document.body.append(box);
  const libras = attachClosedSigning(video, {
    signs: "https://sinais.test/",
    feedbackUrl,
    feedbackKey: "canal-1",
    createRenderer: async () => renderer,
    translator: { name: "eco", translate: async (text) => ({ gloss: text, source: "eco" }) },
  });
  return { box, libras };
}

describe("retorno do público no player", () => {
  it("envia a avaliação com a chave e a página, como texto", () => {
    const beacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
    const { libras } = setup("https://servidor.test/v1/feedback");
    const buttons = libras.createFeedbackButtons();
    const [entendi, naoEntendi] = buttons.querySelectorAll("button");
    expect(entendi?.textContent).toBe("Entendi");
    naoEntendi?.click();
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, body] = beacon.mock.calls[0] as unknown as [string, string];
    expect(url).toBe("https://servidor.test/v1/feedback");
    expect(JSON.parse(body)).toMatchObject({ rating: "bad", key: "canal-1", source: "player" });
    expect(buttons.textContent).toContain("Obrigado!");
  });

  it("sem endereço de retorno, não envia nada", () => {
    const { libras } = setup();
    expect(libras.sendFeedback("good")).toBe(false);
  });

  it("o botão Libras liga e desliga o avatar", async () => {
    const { box, libras } = setup();
    const button = libras.createButton();
    button.click();
    await vi.waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("true"));
    const layer = box.querySelector(".autolibras-closed-signing") as HTMLElement;
    expect(layer.style.display).toBe("block");
    button.click();
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(layer.style.display).toBe("none");
  });
});
