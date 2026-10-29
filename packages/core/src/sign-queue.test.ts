import { describe, expect, it } from "vitest";
import { countSigns, type SignItem, SignQueue } from "./sign-queue";
import { FakeRenderer, flush } from "./test-utils";

const item = (id: string, signs: number): SignItem => ({
  id,
  text: id,
  gloss: Array.from({ length: signs }, (_, i) => `S${i}`).join(" "),
});

describe("countSigns", () => {
  it("ignora marcadores entre colchetes", () => {
    expect(countSigns("EU ESTUDAR ESCOLA [PONTO]")).toBe(3);
    expect(countSigns("  ")).toBe(0);
  });
});

describe("SignQueue", () => {
  it("toca os itens em ordem, um de cada vez", async () => {
    const renderer = new FakeRenderer();
    const queue = new SignQueue(renderer);
    queue.enqueue(item("a", 1));
    queue.enqueue(item("b", 1));
    await flush();
    expect(renderer.played).toEqual(["S0"]);
    await renderer.finish();
    expect(renderer.played).toEqual(["S0", "S0"]);
    await renderer.finish();
    expect(queue.state.current).toBeNull();
    expect(queue.state.pending).toHaveLength(0);
  });

  it("acelera quando o atraso passa do alvo", async () => {
    const renderer = new FakeRenderer();
    const queue = new SignQueue(
      renderer,
      { secondsPerSign: 1, targetLagSeconds: 4, maxLagSeconds: 14, baseSpeed: 1, maxSpeed: 2 },
      () => 0,
    );
    queue.enqueue(item("a", 2));
    await flush();
    expect(renderer.speeds).toEqual([]);
    queue.enqueue(item("b", 7));
    await renderer.finish();
    // Ao iniciar "b": 7 s de atraso nominal → 1 + (7 - 4) / 10 = 1,3.
    expect(renderer.speeds).toEqual([1.3]);
  });

  it("descarta os pendentes mais antigos quando o atraso passa do máximo", async () => {
    const renderer = new FakeRenderer();
    const queue = new SignQueue(renderer, { secondsPerSign: 1, maxLagSeconds: 10 }, () => 0);
    const dropped: string[] = [];
    queue.on("drop", (items) => dropped.push(...items.map((i) => i.id)));
    queue.enqueue(item("atual", 4));
    queue.enqueue(item("velho", 4));
    queue.enqueue(item("novo", 4));
    expect(dropped).toEqual(["velho"]);
    expect(queue.state.pending.map((i) => i.id)).toEqual(["novo"]);
    expect(queue.state.dropped).toBe(1);
  });

  it("nunca descarta o item mais recente", () => {
    const renderer = new FakeRenderer();
    const queue = new SignQueue(renderer, { secondsPerSign: 1, maxLagSeconds: 2 }, () => 0);
    queue.enqueue(item("longo", 50));
    queue.enqueue(item("enorme", 80));
    expect(queue.state.pending.map((i) => i.id)).toEqual(["enorme"]);
  });

  it("aprende a duração real por sinal com as reproduções completas", async () => {
    const renderer = new FakeRenderer();
    let clock = 0;
    const queue = new SignQueue(renderer, { secondsPerSign: 1 }, () => clock);
    queue.enqueue(item("a", 2));
    await flush();
    clock = 6; // 2 sinais em 6 s → 3 s por sinal; média móvel: 1 + (3 - 1) × 0,3 = 1,6.
    await renderer.finish();
    expect(queue.state.secondsPerSign).toBeCloseTo(1.6);

    queue.enqueue(item("b", 2));
    await flush();
    queue.clear(); // Reprodução interrompida não entra na média.
    clock = 100;
    await flush();
    expect(queue.state.secondsPerSign).toBeCloseTo(1.6);
  });

  it("clear esvazia a fila e para o avatar", async () => {
    const renderer = new FakeRenderer();
    const queue = new SignQueue(renderer);
    queue.enqueue(item("a", 1));
    queue.enqueue(item("b", 1));
    await flush();
    queue.clear();
    await flush();
    expect(renderer.stops).toBe(1);
    expect(renderer.played).toHaveLength(1);
    expect(queue.state.pending).toHaveLength(0);
  });
});
