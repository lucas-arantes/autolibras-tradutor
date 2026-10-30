// Mede as mãos dentro do corpo: sobe a demo com o Vite, abre collision.html num Chromium
// headless, toca uma amostra de sinais do pacote publicado com e sem a correção de
// colisões e salva as medidas (JSON) e imagens dos piores sinais, antes e depois.
//
//   node demo/collision-check.mjs [--out DIR] [--chromium /usr/bin/chromium]
//     [--signs URL] [--worst N] [SINAL ...]
//
// Sem sinais na linha de comando, usa palavras frequentes do português que estão no
// pacote, as letras e os algarismos.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const [value] = args.splice(i, 2).slice(1);
  return value;
};
const out = option("--out", join(tmpdir(), "autolibras-collision-check"));
const executablePath = option("--chromium", "/usr/bin/chromium");
const signsUrl = option("--signs", "https://lucas-arantes.github.io/autolibras-sinais/BR/");
const worstCount = Number(option("--worst", "6"));
// Ordena os piores sinais pela mão (padrão) ou pelo antebraço.
const rankBy = option("--rank", "hand");

const COMMON = `
EU VOCÊ ELE ELA NÓS ELES VOCÊS MEU MINHA SEU SUA NOSSO SER ESTAR TER FAZER IR VIR PODER
QUERER SABER VER DAR FALAR DIZER FICAR DEVER PRECISAR GOSTAR ACHAR CONHECER PENSAR CHEGAR
PASSAR SAIR ENTRAR VOLTAR COMEÇAR TERMINAR TRABALHAR ESTUDAR APRENDER ENSINAR COMER BEBER
DORMIR ANDAR CORRER JOGAR LER ESCREVER OUVIR ENTENDER LEMBRAR ESQUECER AJUDAR PERGUNTAR
RESPONDER COMPRAR VENDER PAGAR MORAR VIVER MORRER NASCER ABRIR FECHAR ESPERAR ENCONTRAR
PROCURAR PERDER GANHAR MOSTRAR USAR CHAMAR SENTIR AMAR ODIAR CASAR VIAJAR DIRIGIR NADAR
DANÇAR CANTAR BRINCAR CHORAR RIR SORRIR TOMAR LEVAR TRAZER COLOCAR TIRAR DEIXAR MUDAR
ACONTECER PARECER CONSEGUIR TENTAR CONTINUAR PARAR ACREDITAR DECIDIR ESCOLHER EXPLICAR
CONTAR MANDAR RECEBER ENVIAR LIGAR DESLIGAR TELEFONAR AVISAR CASA ESCOLA TRABALHO FAMÍLIA
PAI MÃE FILHO FILHA IRMÃO IRMÃ AVÔ AVÓ MARIDO ESPOSA AMIGO NAMORADO HOMEM MULHER CRIANÇA
BEBÊ PESSOA GENTE POVO PROFESSOR ALUNO MÉDICO POLÍCIA PRESIDENTE GOVERNO PAÍS BRASIL CIDADE
ESTADO MUNDO RUA CARRO ÔNIBUS AVIÃO DINHEIRO TEMPO DIA NOITE MANHÃ TARDE HOJE ONTEM AMANHÃ
AGORA DEPOIS ANTES SEMPRE NUNCA ANO MÊS SEMANA HORA MINUTO VEZ ÁGUA COMIDA CAFÉ LEITE PÃO
ARROZ FEIJÃO CARNE FRUTA LIVRO PAPEL COMPUTADOR TELEFONE CELULAR TELEVISÃO NOTÍCIA JORNAL
INTERNET VÍDEO MÚSICA FILME FUTEBOL JOGO SAÚDE DOENÇA HOSPITAL REMÉDIO VIDA MORTE AMOR PAZ
GUERRA LEI DIREITO JUSTIÇA PROBLEMA PERGUNTA RESPOSTA NOME IDADE COISA LUGAR PARTE LADO
NÚMERO EMPRESA LOJA MERCADO IGREJA DEUS SURDO OUVINTE LIBRAS LÍNGUA PALAVRA SINAL CORPO
CABEÇA OLHO BOCA MÃO PÉ CORAÇÃO CHUVA SOL FRIO CALOR BOM RUIM BONITO FEIO GRANDE PEQUENO
NOVO VELHO ALTO BAIXO GORDO MAGRO FELIZ TRISTE CANSADO DOENTE CERTO ERRADO FÁCIL DIFÍCIL
IMPORTANTE IGUAL DIFERENTE MUITO POUCO MAIS MENOS TUDO NADA TODO OUTRO MESMO PRIMEIRO
ÚLTIMO PERTO LONGE AQUI ALI LÁ ONDE QUANDO COMO QUE QUEM QUAL QUANTO PORQUE POR_QUE SIM NÃO
TAMBÉM AINDA JÁ SÓ BEM MAL DEVAGAR RÁPIDO JUNTO SOZINHO OBRIGADO DESCULPA POR_FAVOR OI
TCHAU BOM_DIA BOA_NOITE TUDO_BEM PARABÉNS CUIDADO ATENÇÃO NÃO_GOSTAR NÃO_QUERER NÃO_SABER
COM SEM PARA CONTRA ENTRE SOBRE ATÉ SE MAS OU E VERMELHO AZUL VERDE AMARELO BRANCO PRETO
DOMINGO SÁBADO JANEIRO DEZEMBRO
`;
const LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZÇ"];
const DIGITS = [..."0123456789"];

const manifest = await (await fetch(`${signsUrl}manifest.json`)).json();
const requested = args.length ? args : [...COMMON.split(/\s+/), ...LETTERS, ...DIGITS];
const names = [...new Set(requested.filter((n) => n && n in manifest.signs))];
const missing = requested.filter((n) => n && !(n in manifest.signs));
if (missing.length) console.log(`fora do pacote: ${missing.join(" ")}`);

await mkdir(out, { recursive: true });
const server = await createServer({ root: here, configFile: join(here, "vite.config.ts") });
await server.listen();
const url = server.resolvedUrls?.local[0];
const browser = await chromium.launch({
  executablePath,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});

const cm = (m) => Math.round(m * 1000) / 10;

function stats(result) {
  const ok = Object.entries(result).filter(([, r]) => !r.error);
  const hands = ok.map(([, r]) => r.hand.max);
  const penetrating = ok.filter(([, r]) => r.hand.max > 0.01);
  const forearm = ok.filter(([, r]) => r.forearm.max > 0.01);
  const deep = ok.filter(([, r]) => r.hand.max > 0.02);
  const gaps = ok.flatMap(([, r]) => r.touch.gaps).sort((a, b) => a - b);
  const median = (xs) => (xs.length ? xs[Math.floor(xs.length / 2)] : 0);
  return {
    signs: ok.length,
    errors: Object.keys(result).length - ok.length,
    handOver1cm: penetrating.length,
    handOver2cm: deep.length,
    forearmOver1cm: forearm.length,
    maxHandCm: cm(Math.max(0, ...hands)),
    meanMaxHandCm: cm(
      penetrating.reduce((s, [, r]) => s + r.hand.max, 0) / Math.max(1, penetrating.length),
    ),
    secondsHandOver1cm: Math.round(ok.reduce((s, [, r]) => s + r.hand.over[1], 0) * 10) / 10,
    secondsTotal: Math.round(ok.reduce((s, [, r]) => s + r.seconds, 0) * 10) / 10,
    touchFrames: gaps.length,
    touchGapMedianCm: cm(median(gaps)),
    touchGapP90Cm: cm(gaps[Math.floor(gaps.length * 0.9)] ?? 0),
  };
}

try {
  const page = await browser.newPage({ viewport: { width: 520, height: 700 } });
  page.on("pageerror", (error) => console.error(`erro na página: ${error.message}`));
  await page.goto(`${url}collision.html?signs=${encodeURIComponent(signsUrl)}`);
  await page.waitForFunction(() => window.measure, null, { timeout: 60_000 });
  await page.evaluate(() => window.ready);
  console.log(`${names.length} sinais`);

  const runs = {};
  for (const [label, enabled] of [
    ["before", false],
    ["after", true],
  ]) {
    const started = Date.now();
    runs[label] = await page.evaluate(([n, e]) => window.measure(n, e), [names, enabled]);
    console.log(`${label}: ${((Date.now() - started) / 1000).toFixed(0)} s`);
  }
  const summary = { before: stats(runs.before), after: stats(runs.after) };
  console.table(summary);

  const rows = names
    .filter((n) => !runs.before[n]?.error && !runs.after[n]?.error)
    .map((n) => ({ name: n, before: runs.before[n], after: runs.after[n] }))
    .sort((a, b) => b.before[rankBy].max - a.before[rankBy].max);
  console.log("\npiores sinais (cm de penetração da mão, segundos acima de 1 cm):");
  for (const { name, before, after } of rows.slice(0, 25)) {
    console.log(
      `${name.padEnd(14)} antes ${String(cm(before.hand.max)).padStart(5)} cm ${before.hand.over[1].toFixed(2)} s ` +
        `(${before.hand.side} em ${before.hand.volume})  depois ${String(cm(after.hand.max)).padStart(5)} cm ${after.hand.over[1].toFixed(2)} s`,
    );
  }
  await writeFile(join(out, "collision.json"), JSON.stringify({ summary, runs }, null, 1));

  // Imagens dos piores sinais, no instante mais fundo, antes e depois.
  const canvas = page.locator("#avatar");
  const shots = [];
  for (const { name, before } of rows.slice(0, worstCount)) {
    const pair = [];
    for (const [label, enabled] of [
      ["antes", false],
      ["depois", true],
    ]) {
      await page.evaluate(
        ([n, t, e]) => window.capture(n, t, e),
        [name, before[rankBy].at, enabled],
      );
      const file = join(out, `${name}-${label}.png`);
      await canvas.screenshot({ path: file });
      pair.push(file);
    }
    shots.push({ name, at: before[rankBy].at, pair });
  }
  if (shots.length) {
    const cells = await Promise.all(
      shots.map(async ({ name, at, pair }) => {
        const [a, b] = await Promise.all(pair.map((f) => readFile(f, "base64")));
        return `<div class="row"><h2>${name} <small>${at.toFixed(2)} s</small></h2>
          <figure><img src="data:image/png;base64,${a}"><figcaption>antes</figcaption></figure>
          <figure><img src="data:image/png;base64,${b}"><figcaption>depois</figcaption></figure></div>`;
      }),
    );
    const sheet = await browser.newPage({ viewport: { width: 1000, height: 600 } });
    await sheet.setContent(`<style>
      body{font:14px system-ui;margin:12px;background:#fff} .row{display:grid;grid-template-columns:120px 1fr 1fr;gap:8px;align-items:center;margin-bottom:8px}
      h2{font-size:16px;margin:0} small{display:block;color:#666;font-weight:400} figure{margin:0} img{width:100%;display:block;border:1px solid #ddd}
      figcaption{text-align:center;color:#444}</style>${cells.join("")}`);
    await sheet.screenshot({ path: join(out, "antes-depois.png"), fullPage: true });
  }
  console.log(`\nresultados em ${out}`);
} finally {
  await browser.close();
  await server.close();
}
