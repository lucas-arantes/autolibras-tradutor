import type { AvatarRenderer } from "./types";

/** Avatar falso: cada `play` fica pendente até `finish()` ser chamado. */
export class FakeRenderer implements AvatarRenderer {
  readonly name = "fake";
  readonly played: string[] = [];
  readonly speeds: number[] = [];
  stops = 0;
  #resolvers: Array<() => void> = [];

  async load(): Promise<void> {}

  play(gloss: string): Promise<void> {
    this.played.push(gloss);
    return new Promise((resolve) => this.#resolvers.push(resolve));
  }

  /** Termina o sinal atual e deixa a fila avançar. */
  async finish(): Promise<void> {
    this.#resolvers.shift()?.();
    await flush();
  }

  stop(): void {
    this.stops++;
    for (const resolve of this.#resolvers.splice(0)) resolve();
  }

  setSpeed(speed: number): void {
    this.speeds.push(speed);
  }
}

/** Espera todas as microtarefas pendentes (contar ticks de `await` varia entre versões do V8). */
export async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
