import { describe, expect, it } from "vitest";
import { avatarErrorMessage } from "./controller.svelte";

describe("avatarErrorMessage", () => {
  it("explica a falta de WebGL em vez de mostrar o erro do three.js", () => {
    const message = avatarErrorMessage(
      new Error("THREE.WebGLRenderer: Error creating WebGL context."),
    );
    expect(message).toContain("WebGL");
    expect(message).toContain("aceleração de hardware");
    expect(message).not.toContain("THREE");
  });

  it("mantém o motivo dos outros erros", () => {
    expect(avatarErrorMessage(new Error("manifest.json: 404"))).toBe(
      "Não foi possível carregar o avatar: manifest.json: 404",
    );
  });
});
