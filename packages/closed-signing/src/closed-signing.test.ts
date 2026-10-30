import { describe, expect, it } from "vitest";
import { CaptionAssembler, cleanCaption } from "./captions";
import { CueFollower, type CueLike, pickTrack, type TrackLike } from "./follower";

class FakeTrack extends EventTarget implements TrackLike {
  mode = "disabled";
  activeCues: CueLike[] = [];
  constructor(
    readonly kind: string,
    readonly language: string,
  ) {
    super();
  }
  show(...cues: CueLike[]) {
    this.activeCues = cues;
    this.dispatchEvent(new Event("cuechange"));
  }
}

const cue = (startTime: number, text: string): CueLike => ({
  startTime,
  endTime: startTime + 2,
  text,
});

describe("cleanCaption", () => {
  it("tira marcação, descrição de som e troca de falante", () => {
    expect(cleanCaption("<c.yellow>Boa</c> noite\n>> (música) [aplausos] ♪ todos")).toBe(
      "Boa noite todos",
    );
  });
});

describe("CaptionAssembler", () => {
  it("junta a legenda em rolagem em frases, sem repetir", () => {
    const assembler = new CaptionAssembler();
    expect(assembler.push("Boa noite")).toEqual([]);
    expect(assembler.push("Boa noite a todos. Hoje")).toEqual(["Boa noite a todos."]);
    expect(assembler.push("Hoje falamos de Libras.")).toEqual(["Hoje falamos de Libras."]);
    expect(assembler.flush()).toEqual([]);
  });

  it("corta frase longa sem pontuação", () => {
    const assembler = new CaptionAssembler(3);
    expect(assembler.push("um dois três quatro")).toEqual(["um dois três"]);
    expect(assembler.flush()).toEqual(["quatro"]);
  });
});

describe("pickTrack", () => {
  it("prefere a legenda em português e ignora faixas de metadados", () => {
    const tracks = [
      new FakeTrack("metadata", "pt"),
      new FakeTrack("subtitles", "en"),
      new FakeTrack("captions", "pt-BR"),
    ];
    expect(pickTrack(tracks)).toBe(tracks[2]);
    expect(pickTrack([tracks[0] as FakeTrack, tracks[1] as FakeTrack])).toBe(tracks[1]);
    expect(pickTrack([])).toBeNull();
  });
});

describe("CueFollower", () => {
  it("entrega cada frase quando a deixa que a completa aparece", () => {
    const sentences: string[] = [];
    const follower = new CueFollower((s) => sentences.push(s));
    const track = new FakeTrack("subtitles", "pt");
    follower.follow(track);
    expect(track.mode).toBe("hidden");
    track.show(cue(1, "Bom dia a todos."));
    // A mesma deixa continua ativa: não repete.
    track.show(cue(1, "Bom dia a todos."), cue(2, "Hoje"));
    expect(sentences).toEqual(["Bom dia a todos."]);
    track.show(cue(2, "Hoje"), cue(3, "falamos de Libras"));
    // Intervalo sem legenda: solta o trecho incompleto.
    track.show();
    expect(sentences).toEqual(["Bom dia a todos.", "Hoje falamos de Libras"]);
  });

  it("não mexe numa legenda que já está visível e para de seguir com stop", () => {
    const sentences: string[] = [];
    const follower = new CueFollower((s) => sentences.push(s));
    const track = new FakeTrack("captions", "pt");
    track.mode = "showing";
    follower.follow(track);
    expect(track.mode).toBe("showing");
    follower.stop();
    track.show(cue(1, "Oi."));
    expect(sentences).toEqual([]);
  });

  it("depois de reset, a mesma deixa conta de novo (o vídeo voltou)", () => {
    const sentences: string[] = [];
    const follower = new CueFollower((s) => sentences.push(s));
    const track = new FakeTrack("subtitles", "pt");
    follower.follow(track);
    track.show(cue(1, "Oi."));
    follower.reset();
    track.show(cue(1, "Oi."));
    expect(sentences).toEqual(["Oi.", "Oi."]);
  });
});
