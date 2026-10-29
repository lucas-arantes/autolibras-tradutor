export type Listener<T> = (payload: T) => void;

export interface Subscribable<Events extends object> {
  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void;
}

/** Emissor de eventos tipado, sem dependências. */
export class Emitter<Events extends object> implements Subscribable<Events> {
  readonly #listeners = new Map<keyof Events, Set<Listener<never>>>();

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let set = this.#listeners.get(event);
    if (!set) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    set.add(listener as Listener<never>);
    return () => set.delete(listener as Listener<never>);
  }

  protected emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.#listeners.get(event);
    if (!set) return;
    for (const listener of [...set]) {
      (listener as Listener<Events[K]>)(payload);
    }
  }
}
