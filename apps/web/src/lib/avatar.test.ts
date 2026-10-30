import type { AvatarRenderer } from "@autolibras/core";
import { describe, expect, it } from "vitest";
import { createAvatar, defaultAvatarKind, parseAvatarKind, SwitchableRenderer } from "./avatar";

class FakeRenderer implements AvatarRenderer {
  readonly played: string[] = [];
  speed = 1;
  stopped = 0;
  loaded = false;
  #finish?: () => void;

  constructor(readonly name: string) {}

  async load(): Promise<void> {
    this.loaded = true;
  }

  play(gloss: string): Promise<void> {
    this.played.push(gloss);
    return new Promise((resolve) => {
      this.#finish = resolve;
    });
  }

  stop(): void {
    this.stopped++;
    this.#finish?.();
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }
}

describe("parseAvatarKind", () => {
  it("aceita propio, proprio e próprio, além de vlibras", () => {
    expect(parseAvatarKind("propio")).toBe("propio");
    expect(parseAvatarKind("Próprio")).toBe("propio");
    expect(parseAvatarKind("proprio")).toBe("propio");
    expect(parseAvatarKind(" VLibras ")).toBe("vlibras");
    expect(parseAvatarKind("icaro")).toBeNull();
    expect(parseAvatarKind(null)).toBeNull();
  });
});

describe("defaultAvatarKind", () => {
  it("só escolhe o avatar próprio quando há pacote de sinais", () => {
    expect(defaultAvatarKind("")).toBe("vlibras");
    expect(defaultAvatarKind("https://sinais.test/BR/")).toBe("propio");
  });
});

describe("createAvatar", () => {
  it("recusa o avatar próprio sem pacote de sinais", async () => {
    await expect(createAvatar("propio", { signsUrl: " " })).rejects.toThrow(/Pacote de sinais/);
  });
});

describe("SwitchableRenderer", () => {
  it("espera o primeiro avatar antes de carregar e sinalizar", async () => {
    const switchable = new SwitchableRenderer();
    expect(switchable.name).toBe("nenhum");
    switchable.setSpeed(1.5);
    const loading = switchable.load();
    const playing = switchable.play("OI");
    const first = new FakeRenderer("vlibras");
    switchable.use(first);
    await loading;
    await Promise.resolve();
    expect(first.loaded).toBe(true);
    expect(first.played).toEqual(["OI"]);
    expect(first.speed).toBe(1.5);
    first.stop();
    await playing;
  });

  it("troca de avatar parando o anterior e mantém a velocidade", async () => {
    const first = new FakeRenderer("vlibras");
    const second = new FakeRenderer("vrm");
    const switchable = new SwitchableRenderer();
    switchable.use(first);
    switchable.setSpeed(2);
    const pending = switchable.play("CASA");
    switchable.use(second);
    await pending;
    expect(first.stopped).toBe(1);
    expect(second.speed).toBe(2);
    expect(switchable.name).toBe("vrm");
    void switchable.play("EU");
    expect(second.played).toEqual(["EU"]);
    switchable.stop();
    expect(second.stopped).toBe(1);
  });
});
