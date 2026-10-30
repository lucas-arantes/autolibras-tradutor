/**
 * Página do teste de compreensão (`avaliacao.html`): mostra cada frase do teste com
 * a condição sorteada (avatar próprio, avatar do VLibras ou vídeo de intérprete),
 * recolhe a resposta e as notas e exporta tudo em CSV. Não usa servidor: os dados
 * ficam no `localStorage` deste navegador até serem baixados ou apagados.
 *
 * Parâmetros da URL: `signs=URL` preenche o pacote de sinais do avatar próprio.
 */
import {
  type AvatarHandle,
  type AvatarKind,
  createAvatar,
  SIGN_PACK_URL,
  setVLibrasWidgetHidden,
} from "./lib/avatar";
import {
  type Condition,
  DEFAULT_SENTENCES,
  keywordScore,
  parseSentenceSet,
  planSession,
  seedFrom,
  type TestSentence,
  type Trial,
  type TrialResult,
  toCsv,
} from "./lib/evaluation";

const STORAGE_KEY = "autolibras:avaliacao";
/** Frase de treino: não entra nos resultados. */
const PRACTICE_GLOSS = "OI TUDO_BEM [INTERROGAÇÃO]";

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} não existe`);
  return el as T;
}

const ui = {
  setup: $("setup"),
  trial: $("trial"),
  done: $("done"),
  participant: $<HTMLInputElement>("participant"),
  participantNumber: $<HTMLInputElement>("participant-number"),
  signs: $<HTMLInputElement>("signs"),
  speed: $<HTMLInputElement>("speed"),
  sentenceFile: $<HTMLInputElement>("sentence-file"),
  sentenceInfo: $("sentence-info"),
  practice: $<HTMLButtonElement>("practice"),
  start: $<HTMLButtonElement>("start"),
  setupError: $("setup-error"),
  stage: $("stage"),
  stageNote: $("stage-note"),
  show: $<HTMLButtonElement>("show"),
  replay: $<HTMLButtonElement>("replay"),
  progress: $("progress"),
  form: $<HTMLFormElement>("answer-form"),
  answer: $<HTMLTextAreaElement>("answer"),
  naturalness: $("naturalness"),
  confidence: $("confidence"),
  comment: $<HTMLTextAreaElement>("comment"),
  next: $<HTMLButtonElement>("next"),
  skip: $<HTMLButtonElement>("skip"),
  summary: $("summary"),
  downloadSession: $<HTMLButtonElement>("download-session"),
  newSession: $<HTMLButtonElement>("new-session"),
  stored: $("stored"),
  downloadAll: $<HTMLButtonElement>("download-all"),
  clear: $<HTMLButtonElement>("clear"),
  results: $("results"),
};

// ---------------------------------------------------------------- dados guardados

function loadStored(): TrialResult[] {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(data) ? (data as TrialResult[]) : [];
  } catch {
    return [];
  }
}

function saveStored(results: TrialResult[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(results));
  } catch {
    // Sem armazenamento (aba anônima): os resultados ficam só na memória desta página.
  }
}

let stored = loadStored();

function download(name: string, results: readonly TrialResult[]): void {
  // O BOM faz o Excel abrir o arquivo como UTF-8.
  const blob = new Blob([`﻿${toCsv(results)}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderStored(): void {
  const participants = new Set(stored.map((r) => r.participant));
  ui.stored.textContent = stored.length
    ? `${stored.length} respostas de ${participants.size} participante(s).`
    : "Nenhuma resposta guardada.";
  ui.downloadAll.disabled = ui.clear.disabled = stored.length === 0;
  ui.results.replaceChildren(
    ...stored.map((r) => {
      const tr = document.createElement("tr");
      for (const value of [
        r.participant,
        `${r.sentenceId}: ${r.text}`,
        r.condition,
        r.answer,
        r.keywordScore.toFixed(2),
        r.naturalness ?? "",
      ]) {
        const td = document.createElement("td");
        td.textContent = String(value);
        tr.append(td);
      }
      return tr;
    }),
  );
  if (!ui.participantNumber.dataset.touched) {
    ui.participantNumber.value = String(participants.size + 1);
  }
}

// ---------------------------------------------------------------- avatares

const avatars = new Map<AvatarKind, Promise<AvatarHandle>>();
const video = document.createElement("video");
video.playsInline = true;
video.hidden = true;
ui.stage.append(video);

function avatarFor(kind: AvatarKind): Promise<AvatarHandle> {
  let pending = avatars.get(kind);
  if (!pending) {
    pending = (async () => {
      const handle = await createAvatar(kind, {
        signsUrl: ui.signs.value.trim() || SIGN_PACK_URL,
        background: null,
      });
      if (handle.canvas) {
        handle.canvas.hidden = true;
        ui.stage.append(handle.canvas);
      }
      await handle.renderer.load();
      return handle;
    })();
    pending.catch(() => avatars.delete(kind));
    avatars.set(kind, pending);
  }
  return pending;
}

/** Mostra só o que a condição usa e devolve a função que exibe a frase. */
async function prepare(condition: Condition, sentence: { gloss: string; video?: string }) {
  for (const handle of avatars.values()) {
    void handle.then((h) => {
      if (h.canvas) h.canvas.hidden = true;
    });
  }
  video.hidden = condition !== "video";
  setVLibrasWidgetHidden(condition !== "vlibras");
  if (condition === "video") {
    ui.stageNote.textContent = "";
    video.src = sentence.video ?? "";
    return () =>
      new Promise<void>((resolve, reject) => {
        video.currentTime = 0;
        video.onended = () => resolve();
        video.onerror = () => reject(new Error("Não foi possível tocar o vídeo"));
        video.play().catch(reject);
      });
  }
  ui.stageNote.textContent = "Carregando o avatar…";
  const handle = await avatarFor(condition);
  ui.stageNote.textContent =
    condition === "vlibras" ? "O avatar do VLibras aparece na janela no canto da tela." : "";
  if (handle.canvas) handle.canvas.hidden = false;
  handle.renderer.setSpeed(Number(ui.speed.value) || 1);
  return () => handle.renderer.play(sentence.gloss);
}

// ---------------------------------------------------------------- escalas 1 a 5

function buildScale(host: HTMLElement, name: string, low: string, high: string): void {
  for (let value = 1; value <= 5; value++) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.value = String(value);
    const text = value === 1 ? `1 · ${low}` : value === 5 ? `5 · ${high}` : String(value);
    label.append(input, text);
    host.append(label);
  }
}
buildScale(ui.naturalness, "naturalness", "nada", "muito");
buildScale(ui.confidence, "confidence", "chutei", "certeza");

function scaleValue(name: string): number | null {
  const checked = ui.form.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`);
  return checked ? Number(checked.value) : null;
}

// ---------------------------------------------------------------- sessão

let sentences: TestSentence[] = DEFAULT_SENTENCES;
let trials: Trial[] = [];
let current = 0;
let sessionResults: TrialResult[] = [];
let session = { participant: "", id: "" };
let play: (() => Promise<void>) | null = null;
let shownAt = 0;
let replays = 0;
let startedAt = "";

function selectedConditions(): Condition[] {
  return [...document.querySelectorAll<HTMLInputElement>('input[name="condition"]:checked')].map(
    (input) => input.value as Condition,
  );
}

function showSection(section: "setup" | "trial" | "done"): void {
  ui.setup.hidden = section !== "setup";
  ui.trial.hidden = section !== "trial";
  ui.done.hidden = section !== "done";
}

function setupError(message: string): void {
  ui.setupError.textContent = message;
}

ui.signs.value = new URLSearchParams(location.search).get("signs") ?? SIGN_PACK_URL;
ui.sentenceInfo.textContent = `Usando as ${DEFAULT_SENTENCES.length} frases padrão.`;
ui.participantNumber.addEventListener("input", () => {
  ui.participantNumber.dataset.touched = "1";
});

ui.sentenceFile.addEventListener("change", async () => {
  const file = ui.sentenceFile.files?.[0];
  if (!file) return;
  try {
    sentences = parseSentenceSet(JSON.parse(await file.text()));
    const withVideo = sentences.filter((s) => s.video).length;
    ui.sentenceInfo.textContent = `${sentences.length} frases de ${file.name}, ${withVideo} com vídeo.`;
    setupError("");
  } catch (error) {
    sentences = DEFAULT_SENTENCES;
    setupError(`Conjunto de frases inválido: ${error instanceof Error ? error.message : error}`);
  }
});

ui.practice.addEventListener("click", async () => {
  const condition = selectedConditions().find((c) => c !== "video") ?? "propio";
  setupError("");
  ui.practice.disabled = true;
  try {
    showSection("trial");
    ui.progress.textContent = "Treino (não conta)";
    const run = await prepare(condition, { gloss: PRACTICE_GLOSS });
    await run();
  } catch (error) {
    setupError(error instanceof Error ? error.message : String(error));
  } finally {
    ui.practice.disabled = false;
    showSection("setup");
  }
});

ui.start.addEventListener("click", () => {
  const participant = ui.participant.value.trim();
  const conditions = selectedConditions();
  if (!participant) return setupError("Preencha o código do participante.");
  if (conditions.length === 0) return setupError("Escolha pelo menos uma condição.");
  if (conditions.includes("video") && !sentences.some((s) => s.video)) {
    return setupError("Nenhuma frase do conjunto tem vídeo. Carregue um conjunto com vídeos.");
  }
  if (conditions.includes("propio") && !(ui.signs.value.trim() || SIGN_PACK_URL)) {
    return setupError("O avatar próprio precisa do endereço do pacote de sinais.");
  }
  setupError("");
  const number = Math.max(1, Math.floor(Number(ui.participantNumber.value) || 1));
  session = { participant, id: new Date().toISOString() };
  trials = planSession(sentences, conditions, number - 1, seedFrom(participant));
  sessionResults = [];
  current = 0;
  showSection("trial");
  void loadTrial();
});

async function loadTrial(): Promise<void> {
  const trial = trials[current];
  if (!trial) return finish();
  ui.form.reset();
  ui.next.disabled = true;
  ui.replay.disabled = true;
  ui.show.disabled = true;
  ui.progress.textContent = `Frase ${current + 1} de ${trials.length}`;
  play = null;
  replays = 0;
  shownAt = 0;
  startedAt = new Date().toISOString();
  try {
    play = await prepare(trial.condition, trial.sentence);
    ui.show.disabled = false;
  } catch (error) {
    ui.stageNote.textContent = `Erro: ${error instanceof Error ? error.message : error}`;
  }
}

async function present(isReplay: boolean): Promise<void> {
  if (!play) return;
  ui.show.disabled = ui.replay.disabled = true;
  if (isReplay) replays++;
  try {
    await play();
  } catch (error) {
    ui.stageNote.textContent = `Erro: ${error instanceof Error ? error.message : error}`;
  }
  if (!shownAt) shownAt = performance.now();
  ui.replay.disabled = false;
  updateNext();
}

function updateNext(): void {
  ui.next.disabled = !shownAt || !ui.answer.value.trim();
}

ui.show.addEventListener("click", () => void present(false));
ui.replay.addEventListener("click", () => void present(true));
ui.answer.addEventListener("input", updateNext);

function record(skipped: boolean): void {
  const trial = trials[current];
  if (!trial) return;
  const answer = skipped ? "" : ui.answer.value.trim();
  const comment = ui.comment.value.trim();
  const result: TrialResult = {
    participant: session.participant,
    session: session.id,
    trial: current + 1,
    sentenceId: trial.sentence.id,
    category: trial.sentence.category,
    condition: trial.condition,
    text: trial.sentence.text,
    gloss: trial.sentence.gloss,
    answer,
    keywordScore: keywordScore(answer, trial.sentence.keywords),
    naturalness: skipped ? null : scaleValue("naturalness"),
    confidence: skipped ? null : scaleValue("confidence"),
    replays,
    responseSeconds: shownAt ? Math.round((performance.now() - shownAt) / 100) / 10 : 0,
    comment: skipped ? ["(pulada)", comment].filter(Boolean).join(" ") : comment,
    startedAt,
  };
  sessionResults.push(result);
  // Grava a cada resposta: se a página fechar, o que já foi respondido não se perde.
  stored = [...stored, result];
  saveStored(stored);
  renderStored();
  current++;
  void loadTrial();
}

ui.form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!ui.next.disabled) record(false);
});
ui.skip.addEventListener("click", () => record(true));

function finish(): void {
  for (const handle of avatars.values()) void handle.then((h) => h.renderer.stop());
  video.pause();
  setVLibrasWidgetHidden(true);
  const answered = sessionResults.filter((r) => r.answer);
  const mean = (values: number[]) =>
    values.length ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2) : "sem dados";
  ui.summary.textContent =
    `${answered.length} de ${sessionResults.length} frases respondidas. ` +
    `Média das palavras-chave: ${mean(answered.map((r) => r.keywordScore))} ` +
    "(só um apoio; a correção final é feita por pessoas).";
  showSection("done");
}

ui.downloadSession.addEventListener("click", () => {
  const date = session.id.slice(0, 10);
  download(`avaliacao-${session.participant}-${date}.csv`, sessionResults);
});
ui.newSession.addEventListener("click", () => {
  ui.participant.value = "";
  showSection("setup");
});
ui.downloadAll.addEventListener("click", () => {
  download(`avaliacao-todas-${new Date().toISOString().slice(0, 10)}.csv`, stored);
});
ui.clear.addEventListener("click", () => {
  if (!confirm("Apagar todas as respostas guardadas neste navegador? Baixe o CSV antes.")) return;
  stored = [];
  saveStored(stored);
  renderStored();
});

renderStored();
