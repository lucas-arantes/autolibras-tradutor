import { CaptionAssembler, cleanCaption } from "./captions";

/** Parte da `TextTrack` usada aqui (permite testar sem DOM). */
export interface CueLike {
  startTime: number;
  endTime: number;
  text?: string;
}

export interface TrackLike extends EventTarget {
  kind: string;
  language: string;
  mode: string;
  activeCues: ArrayLike<CueLike> | null;
}

export interface TextTrackListLike {
  readonly length: number;
  [index: number]: TrackLike;
}

/** Faixa de legenda em português, se houver; senão a primeira de legenda. */
export function pickTrack(tracks: TextTrackListLike, language = "pt"): TrackLike | null {
  const all = Array.from({ length: tracks.length }, (_, i) => tracks[i]).filter(
    (track): track is TrackLike => !!track && ["subtitles", "captions"].includes(track.kind),
  );
  return all.find((track) => track.language.toLowerCase().startsWith(language)) ?? all[0] ?? null;
}

/**
 * Acompanha as deixas ativas de uma faixa de legenda e entrega frases prontas
 * para sinalizar. Cada frase sai quando a deixa que a completa aparece, então
 * a sinalização segue o tempo do vídeo, inclusive em lives com atraso.
 */
export class CueFollower {
  readonly #assembler: CaptionAssembler;
  readonly #seen = new Set<string>();
  #track: TrackLike | null = null;
  readonly #onCueChange = () => this.#update();

  constructor(
    readonly onSentence: (text: string) => void,
    maxWords?: number,
  ) {
    this.#assembler = new CaptionAssembler(maxWords);
  }

  get track(): TrackLike | null {
    return this.#track;
  }

  follow(track: TrackLike | null): void {
    this.#track?.removeEventListener("cuechange", this.#onCueChange);
    this.#track = track;
    this.reset();
    if (!track) return;
    // Sem deixar a faixa "disabled", o navegador não ativa as deixas; "hidden"
    // não mostra a legenda, e se ela já estava visível, continua visível.
    if (track.mode === "disabled") track.mode = "hidden";
    track.addEventListener("cuechange", this.#onCueChange);
    this.#update();
  }

  /** Esquece o que já foi visto (o vídeo pulou para outro ponto). */
  reset(): void {
    this.#seen.clear();
    this.#assembler.reset();
  }

  stop(): void {
    this.follow(null);
  }

  #update(): void {
    const cues = Array.from(this.#track?.activeCues ?? []).sort(
      (a, b) => a.startTime - b.startTime,
    );
    if (cues.length === 0) {
      // Intervalo sem legenda: o trecho incompleto não vai terminar.
      for (const sentence of this.#assembler.flush()) this.onSentence(sentence);
      return;
    }
    for (const cue of cues) {
      const text = cleanCaption(cue.text ?? "");
      const id = `${cue.startTime}|${cue.endTime}|${text}`;
      if (this.#seen.has(id) || !text) continue;
      this.#seen.add(id);
      for (const sentence of this.#assembler.push(text)) this.onSentence(sentence);
    }
  }
}
