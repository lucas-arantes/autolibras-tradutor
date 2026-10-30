import {
  fingerspellLetters,
  type GlossSentence,
  isLetterToken,
  lookupCandidates,
  numberSigns,
  parseGloss,
  type SignToken,
} from "./gloss";

/** Dados de um sinal no manifest do pacote (tempos em segundos na velocidade 1). */
export interface SignInfo {
  duration: number;
  /** Fim da preparação (a mão saiu do repouso e chegou ao início do sinal). */
  strokeStart: number;
  /** Início do retorno ao repouso. */
  strokeEnd: number;
  /** Posição dos punhos [esquerdo, direito] no início e no fim do trecho principal. */
  hands?: { strokeStart: number[][]; strokeEnd: number[][] };
}

/** O que o planejador precisa saber do pacote de sinais. */
export interface SignCatalog {
  info(name: string): SignInfo | undefined;
  /** Sinal cujo primeiro quadro é a pose de repouso. */
  readonly rest: string | null;
}

export type UnitKind = "sign" | "letter" | "placeholder";

export interface SignUnit {
  kind: UnitKind;
  /** Clipe a tocar; `null` em placeholders (o avatar fica no repouso). */
  clip: string | null;
  /** Texto mostrado para quem acompanha (sinal, letra ou palavra ausente). */
  label: string;
  token: SignToken;
  sentence: number;
  /** Índice da palavra soletrada (ou do número) a que a letra pertence. */
  word?: number;
  /** Letra igual à anterior na mesma palavra (`ANNA`): a mão desliza um pouco para o lado. */
  repeat?: boolean;
}

export type ExpressionCueName = "browUp" | "browDown" | "surprised" | "intense";

export interface ExpressionCue {
  name: ExpressionCueName;
  start: number;
  end: number;
  weight: number;
}

export interface HeadCue {
  /** `shake`: balanço de negação; `tilt`: cabeça inclinada (pergunta). */
  kind: "shake" | "tilt";
  start: number;
  end: number;
  /** Inclinação para a frente (rad, positivo abaixa o queixo), só em `tilt`. */
  pitch?: number;
}

/** Deslocamento lateral da mão dominante, para repetir uma letra ou um algarismo. */
export interface HandCue {
  kind: "shift";
  start: number;
  end: number;
}

export interface Segment {
  unit: SignUnit;
  clip: string | null;
  /** Início da transição vinda do segmento anterior (tempo da linha do tempo). */
  start: number;
  /** Duração da transição (crossfade de pose para pose). */
  blend: number;
  /** Trecho do clipe que é tocado. */
  from: number;
  to: number;
  /** Velocidade relativa do clipe (sinais intensos ficam mais lentos). */
  rate: number;
  /** Pausa parada no fim do trecho. */
  hold: number;
  /** Momento em que termina o trecho principal (sem o retorno ao repouso). */
  strokeEndAt: number;
  end: number;
}

export interface Timeline {
  segments: Segment[];
  expressions: ExpressionCue[];
  head: HeadCue[];
  hand: HandCue[];
  duration: number;
}

export interface TimelineOptions {
  /** Limites do crossfade entre sinais, conforme a distância entre as mãos. */
  minBlend: number;
  maxBlend: number;
  /** Distância entre as mãos (em comprimentos de braço) que leva ao crossfade máximo. */
  blendDistance: number;
  /** Transição inicial, vinda da pose em que o avatar estiver. */
  firstBlend: number;
  /** Tempo máximo de cada letra no meio de uma palavra soletrada. */
  letterSeconds: number;
  /** Pausa entre frases. */
  sentencePause: number;
  /** Duração do placeholder de um sinal sem clipe nem letras. */
  placeholderSeconds: number;
  /** Velocidade relativa dos sinais com `(+)`. */
  intenseRate: number;
  /** Tempo máximo de uma letra com movimento (J, Z...) no meio de uma palavra. */
  movingLetterSeconds: number;
  /** Inclinação da cabeça na pergunta sim/não e na pergunta QU- (rad). */
  questionPitch: number;
  whQuestionPitch: number;
}

export const DEFAULT_TIMELINE_OPTIONS: TimelineOptions = {
  minBlend: 0.12,
  maxBlend: 0.25,
  blendDistance: 0.8,
  firstBlend: 0.2,
  letterSeconds: 0.35,
  sentencePause: 0.25,
  placeholderSeconds: 0.7,
  intenseRate: 0.8,
  movingLetterSeconds: 0.9,
  questionPitch: 0.09,
  whQuestionPitch: -0.06,
};

/** Letras da datilologia que têm movimento (o trecho principal não pode ser cortado). */
export const MOVING_LETTERS = new Set(["H", "J", "K", "X", "Z", "Ç"]);

/** O punho se desloca mais que isso (em comprimentos de braço) dentro do trecho principal. */
const MOVING_DISTANCE = 0.05;

function findClip(catalog: SignCatalog, names: string[]): string | null {
  return names.find((name) => catalog.info(name)) ?? null;
}

/**
 * Decide o que tocar para cada sinal da glosa: o clipe do sinal, os algarismos de um
 * número, os clipes das partes de um sinal composto (`BOM_DIA` → `BOM` `DIA`), a
 * datilologia letra por letra ou, se nem as letras existirem, um placeholder. Letras
 * soltas seguidas (`A N A`) formam uma palavra soletrada.
 */
export function resolveUnits(sentences: GlossSentence[], catalog: SignCatalog): SignUnit[] {
  const units: SignUnit[] = [];
  let word = 0;
  const spell = (
    token: SignToken,
    s: number,
    parts: Array<{ name: string; label: string }>,
  ): boolean => {
    const found = parts
      .map((p) => ({ ...p, clip: findClip(catalog, [p.name]) }))
      .filter((p) => p.clip);
    if (found.length === 0) return false;
    let prev: string | null = null;
    for (const { label, clip } of found) {
      const kind = label.length === 1 ? "letter" : "sign";
      const repeat = kind === "letter" && clip === prev;
      units.push({ kind, clip, label, token, sentence: s, word, ...(repeat && { repeat }) });
      prev = kind === "letter" ? clip : null;
    }
    word++;
    return true;
  };
  sentences.forEach((sentence, s) => {
    const { signs } = sentence;
    for (let i = 0; i < signs.length; i++) {
      const token = signs[i] as SignToken;
      // Letras soltas seguidas: uma palavra soletrada, com o ritmo da datilologia.
      if (isLetterToken(token) && signs[i + 1] && isLetterToken(signs[i + 1] as SignToken)) {
        let j = i;
        while (signs[j] && isLetterToken(signs[j] as SignToken)) j++;
        const run = signs.slice(i, j);
        let prev: string | null = null;
        for (const letter of run) {
          const clip = findClip(catalog, [letter.base]);
          if (!clip) {
            units.push({
              kind: "placeholder",
              clip: null,
              label: letter.base,
              token: letter,
              sentence: s,
            });
            prev = null;
            continue;
          }
          const repeat = clip === prev;
          units.push({
            kind: "letter",
            clip,
            label: letter.base,
            token: letter,
            sentence: s,
            word,
            ...(repeat && { repeat }),
          });
          prev = clip;
        }
        word++;
        i = j - 1;
        continue;
      }
      const clip = findClip(catalog, lookupCandidates(token));
      if (clip) {
        units.push({ kind: "sign", clip, label: clip, token, sentence: s });
        continue;
      }
      const number = numberSigns(token.base);
      if (number) {
        if (
          !spell(
            token,
            s,
            number.map((name) => ({ name, label: name })),
          )
        ) {
          units.push({ kind: "placeholder", clip: null, label: token.base, token, sentence: s });
        }
        continue;
      }
      const parts = token.base.split("_").filter(Boolean);
      const partClips = parts.length > 1 ? parts.map((p) => findClip(catalog, [p])) : [];
      if (partClips.length > 0 && partClips.every(Boolean)) {
        partClips.forEach((c, k) => {
          units.push({ kind: "sign", clip: c, label: parts[k] ?? "", token, sentence: s });
        });
        continue;
      }
      const spelled = lookupCandidates(token).at(-1) ?? token.base;
      const letters = fingerspellLetters(spelled.replaceAll("_", ""));
      if (
        !spell(
          token,
          s,
          letters.map((name) => ({ name, label: name })),
        )
      ) {
        units.push({ kind: "placeholder", clip: null, label: token.base, token, sentence: s });
      }
    }
  });
  return units;
}

/** A letra (ou o algarismo) tem movimento próprio, que não pode ser cortado. */
export function isMovingLetter(unit: SignUnit, info: SignInfo | undefined): boolean {
  if (MOVING_LETTERS.has(unit.label)) return true;
  const start = info?.hands?.strokeStart;
  const end = info?.hands?.strokeEnd;
  if (!start || !end) return false;
  return start.some((p, k) => {
    const q = end[k] ?? p;
    return Math.hypot(...p.map((c, i) => c - (q[i] ?? c))) > MOVING_DISTANCE;
  });
}

function handDistance(a: SignInfo | undefined, b: SignInfo | undefined): number | null {
  const end = a?.hands?.strokeEnd;
  const start = b?.hands?.strokeStart;
  if (!end || !start) return null;
  let max = 0;
  for (let k = 0; k < Math.min(end.length, start.length); k++) {
    const p = end[k] ?? [];
    const q = start[k] ?? [];
    const d = Math.hypot(
      (p[0] ?? 0) - (q[0] ?? 0),
      (p[1] ?? 0) - (q[1] ?? 0),
      (p[2] ?? 0) - (q[2] ?? 0),
    );
    max = Math.max(max, d);
  }
  return max;
}

/**
 * Monta a linha do tempo: cada sinal toca só o trecho principal (a preparação do
 * primeiro e o retorno do último são mantidos), com crossfade entre o fim de um e o
 * início do próximo. Também gera as trilhas de expressão facial e de cabeça.
 */
export function buildTimeline(
  units: SignUnit[],
  sentences: GlossSentence[],
  catalog: SignCatalog,
  options: Partial<TimelineOptions> = {},
): Timeline {
  const o = { ...DEFAULT_TIMELINE_OPTIONS, ...options };
  const segments: Segment[] = [];
  let time = 0;
  units.forEach((unit, i) => {
    const prev = units[i - 1];
    const next = units[i + 1];
    const first = i === 0;
    const last = i === units.length - 1;
    const clip = unit.clip ?? catalog.rest;
    const info = clip ? catalog.info(clip) : undefined;
    let from = 0;
    let to = 0;
    let hold = 0;
    if (unit.kind === "placeholder" || !info) {
      hold = o.placeholderSeconds;
    } else {
      from = first ? 0 : info.strokeStart;
      to = last ? info.duration : info.strokeEnd;
      const spellingOn =
        unit.kind === "letter" && next?.kind === "letter" && next.word === unit.word;
      if (spellingOn) {
        const limit = isMovingLetter(unit, info) ? o.movingLetterSeconds : o.letterSeconds;
        to = Math.min(to, info.strokeStart + limit);
      }
      if (!last && next && next.sentence !== unit.sentence) hold = o.sentencePause;
    }
    let blend = o.firstBlend;
    if (!first) {
      const prevInfo = prev?.clip ? catalog.info(prev.clip) : undefined;
      const d = handDistance(prevInfo, info);
      blend =
        d === null
          ? o.maxBlend
          : Math.min(o.maxBlend, o.minBlend + ((o.maxBlend - o.minBlend) * d) / o.blendDistance);
    }
    const rate = unit.token.intense && unit.kind === "sign" ? o.intenseRate : 1;
    const play = (to - from) / rate;
    const strokeTo = info && last ? Math.min(to, info.strokeEnd) : to;
    const segment: Segment = {
      unit,
      clip,
      start: time,
      blend,
      from,
      to,
      rate,
      hold,
      strokeEndAt:
        time + blend + (strokeTo - from) / rate + (unit.kind === "placeholder" ? hold : 0),
      end: time + blend + play + hold,
    };
    segments.push(segment);
    time = segment.end;
  });

  const expressions: ExpressionCue[] = [];
  const head: HeadCue[] = [];
  const hand: HandCue[] = [];
  for (const seg of segments) {
    if (seg.unit.repeat) hand.push({ kind: "shift", start: seg.start, end: seg.strokeEndAt });
  }
  sentences.forEach((sentence, s) => {
    const own = segments.filter((seg) => seg.unit.sentence === s);
    const firstSeg = own[0];
    const lastSeg = own.at(-1);
    if (!firstSeg || !lastSeg) return;
    const start = firstSeg.start;
    const end = lastSeg.strokeEndAt + 0.15;
    if (sentence.type === "question") {
      expressions.push({ name: "browUp", start, end, weight: 1 });
      head.push({ kind: "tilt", start, end, pitch: o.questionPitch });
    }
    if (sentence.type === "whQuestion") {
      expressions.push({ name: "browDown", start, end, weight: 1 });
      head.push({ kind: "tilt", start, end, pitch: o.whQuestionPitch });
    }
    if (sentence.type === "exclamation") {
      expressions.push({ name: "surprised", start, end, weight: 0.6 });
    }
  });
  // Negação e intensidade valem para o sinal (ou as letras/partes) do token.
  for (const token of new Set(segments.map((seg) => seg.unit.token))) {
    const own = segments.filter((seg) => seg.unit.token === token);
    const firstSeg = own[0];
    const lastSeg = own.at(-1);
    if (!firstSeg || !lastSeg) continue;
    const start = firstSeg.start + firstSeg.blend;
    const end = lastSeg.strokeEndAt;
    if (token.negated) {
      head.push({ kind: "shake", start, end });
      expressions.push({ name: "browDown", start, end, weight: 0.6 });
    }
    if (token.intense) expressions.push({ name: "intense", start, end, weight: 0.5 });
  }
  return { segments, expressions, head, hand, duration: time };
}

/** Atalho: glosa → linha do tempo. */
export function planGloss(
  gloss: string,
  catalog: SignCatalog,
  options: Partial<TimelineOptions> = {},
): Timeline {
  const sentences = parseGloss(gloss);
  return buildTimeline(resolveUnits(sentences, catalog), sentences, catalog, options);
}

/** Segmento ativo no instante `t` (o último, depois do fim). */
export function segmentAt(timeline: Timeline, t: number): Segment | undefined {
  const { segments } = timeline;
  for (const segment of segments) {
    if (t < segment.end) return segment;
  }
  return segments.at(-1);
}
