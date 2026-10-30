import { createVrmRenderer, type SignEvent } from "../src/index";

// `?signs=` e `?avatar=` permitem usar um pacote de sinais ou um modelo publicados em outro lugar.
const params = new URLSearchParams(location.search);
const signsUrl = params.get("signs") ?? new URL("signs/", location.href).href;
const avatarUrl = params.get("avatar") ?? new URL("avatar/autolibras.vrm", location.href).href;

const EXAMPLES = [
  "OI [EXCLAMAÇÃO] EU NOME A N A [PONTO]",
  "VOCÊ NOME QUAL [INTERROGAÇÃO]",
  "BOM_DIA TUDO_BEM [INTERROGAÇÃO]",
  "EU NÃO_GOSTAR ÁGUA [PONTO]",
  "OBRIGADO(+) [EXCLAMAÇÃO]",
  "EU CASA ONDE [INTERROGAÇÃO] SAPATO",
];

function element<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} não existe`);
  return el as T;
}

const canvas = element<HTMLCanvasElement>("avatar");
const glossInput = element<HTMLTextAreaElement>("gloss");
const playButton = element<HTMLButtonElement>("play");
const stopButton = element<HTMLButtonElement>("stop");
const speedInput = element<HTMLInputElement>("speed");
const speedValue = element<HTMLOutputElement>("speed-value");
const contactsInput = element<HTMLInputElement>("contacts");
const status = element<HTMLDivElement>("status");
const now = element<HTMLDivElement>("now");
const packInfo = element<HTMLElement>("pack-info");
const signList = element<HTMLDivElement>("signs");
const examples = element<HTMLDivElement>("examples");

const renderer = createVrmRenderer({ canvas, avatarUrl, signs: signsUrl });
// Para a verificação automática no navegador (demo/browser-check.mjs).
Object.assign(window, { avatar: renderer });

function setStatus(text: string, placeholder = false): void {
  status.textContent = text;
  status.classList.toggle("placeholder", placeholder);
}

renderer.on("sign", ({ unit, index, total }: SignEvent) => {
  const placeholder = unit.kind === "placeholder";
  const kind = { sign: "sinal", letter: "letra", placeholder: "sem sinal nem letras" }[unit.kind];
  now.textContent = placeholder ? `? ${unit.label}` : unit.label;
  now.classList.toggle("placeholder", placeholder);
  setStatus(`${index + 1}/${total} · ${kind}: ${unit.label}`, placeholder);
});
renderer.on("error", (error) => setStatus(error.message, true));

async function play(gloss: string): Promise<void> {
  setStatus("Sinalizando…");
  const started = performance.now();
  await renderer.play(gloss);
  now.textContent = "";
  setStatus(`Pronto (${((performance.now() - started) / 1000).toFixed(1)} s)`);
}

playButton.addEventListener("click", () => void play(glossInput.value));
stopButton.addEventListener("click", () => renderer.stop());
speedInput.addEventListener("input", () => {
  renderer.setSpeed(Number(speedInput.value));
  speedValue.textContent = `${speedInput.value}×`;
});
// Desligar mostra a pose só com as rotações copiadas, sem o IK que leva a mão ao rosto,
// ao peito ou à outra mão.
contactsInput.addEventListener("change", () => renderer.setContacts(contactsInput.checked));
for (const example of EXAMPLES) {
  const button = document.createElement("button");
  button.textContent = example;
  button.addEventListener("click", () => {
    glossInput.value = example;
    void play(example);
  });
  examples.append(button);
}

try {
  await renderer.load();
  const { manifest } = renderer.pack;
  const names = renderer.pack.names.sort((a, b) => a.localeCompare(b, "pt-BR"));
  packInfo.textContent = `Pacote de sinais: ${names.length} sinais, licença ${manifest.license}.`;
  for (const name of names) {
    const chip = document.createElement("button");
    chip.textContent = name;
    chip.addEventListener("click", () => {
      glossInput.value = `${glossInput.value.trim()} ${name}`.trim();
    });
    signList.append(chip);
  }
  playButton.disabled = false;
  setStatus("Pronto");
} catch (error) {
  setStatus(
    `Não deu para carregar: ${error instanceof Error ? error.message : error}. ` +
      "Gere o pacote com tools/clips/build_pack.py (veja o README do pacote).",
    true,
  );
}
