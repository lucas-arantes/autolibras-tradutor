import { describe, expect, it } from "vitest";
import { Pcm16Encoder, toInt16 } from "./pcm";

describe("toInt16", () => {
  it("converte e limita a faixa", () => {
    expect(toInt16(0)).toBe(0);
    expect(toInt16(1)).toBe(32767);
    expect(toInt16(-1)).toBe(-32768);
    expect(toInt16(2)).toBe(32767);
  });
});

describe("Pcm16Encoder", () => {
  it("reduz 48 kHz para 16 kHz tirando a média de cada trio", () => {
    const encoder = new Pcm16Encoder(48_000);
    const out = encoder.push(Float32Array.from([0.3, 0.3, 0.3, -0.6, 0, 0]));
    expect(Array.from(out)).toEqual([toInt16(0.3), toInt16(-0.2)]);
  });

  it("produz a quantidade certa de amostras com blocos de tamanho qualquer", () => {
    for (const rate of [44_100, 48_000]) {
      const encoder = new Pcm16Encoder(rate);
      let total = 0;
      // 1 segundo em blocos de 128 amostras, como chegam do AudioWorklet.
      for (let i = 0; i < rate; i += 128) {
        total += encoder.push(new Float32Array(Math.min(128, rate - i))).length;
      }
      expect(Math.abs(total - 16_000)).toBeLessThanOrEqual(1);
    }
  });

  it("recusa taxa menor que 16 kHz", () => {
    expect(() => new Pcm16Encoder(8_000)).toThrow("menor");
  });
});
