// Verificação no navegador: sobe a demo com o Vite, abre um Chromium headless com WebGL
// por software (SwiftShader), sinaliza algumas glosas e salva capturas de tela.
//
//   node demo/browser-check.mjs [--out DIR] [--chromium /usr/bin/chromium] [glosa ...]
//
// Precisa do pacote de sinais em demo/public/signs (tools/clips/build_pack.py) e do
// modelo em assets/autolibras.vrm.
import { mkdir, writeFile } from "node:fs/promises";
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
const out = option("--out", join(tmpdir(), "autolibras-avatar-check"));
const executablePath = option("--chromium", "/usr/bin/chromium");
const glosses = args.length
  ? args
  : [
      "OI [EXCLAMAÇÃO] EU NOME A N A [PONTO]",
      "VOCÊ NOME QUAL [INTERROGAÇÃO]",
      "EU NÃO_GOSTAR ÁGUA [PONTO]",
      "BOM_DIA OBRIGADO SAPATO",
    ];

await mkdir(out, { recursive: true });
const server = await createServer({ root: here, configFile: join(here, "vite.config.ts") });
await server.listen();
const url = server.resolvedUrls?.local[0];
const browser = await chromium.launch({
  executablePath,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const failures = [];
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  page.on("pageerror", (error) => failures.push(`erro na página: ${error.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") failures.push(`console: ${msg.text()}`);
  });
  await page.goto(url);
  await page.waitForFunction(() => !document.querySelector("#play")?.disabled, null, {
    timeout: 60_000,
  });
  const info = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const dbg = gl?.getExtension("WEBGL_debug_renderer_info");
    return {
      webgl: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : String(Boolean(gl)),
      pack: document.querySelector("#pack-info")?.textContent,
    };
  });
  console.log(`WebGL: ${info.webgl}\n${info.pack}`);
  await page.screenshot({ path: join(out, "00-repouso.png") });

  const report = [];
  for (const [g, gloss] of glosses.entries()) {
    // Captura uma imagem no meio de cada segmento, a partir do evento `sign`.
    const result = await page.evaluate(async (gloss) => {
      const avatar = window.avatar;
      const events = [];
      let timeline;
      const offPlan = avatar.on("plan", (t) => {
        timeline = t;
      });
      const offSign = avatar.on("sign", (e) => {
        events.push({ at: performance.now(), kind: e.unit.kind, label: e.unit.label });
      });
      let frames = 0;
      let counting = true;
      const count = () => {
        frames++;
        if (counting) requestAnimationFrame(count);
      };
      requestAnimationFrame(count);
      const start = performance.now();
      await avatar.play(gloss);
      const elapsed = (performance.now() - start) / 1000;
      counting = false;
      offPlan();
      offSign();
      return {
        elapsed,
        planned: timeline?.duration ?? 0,
        fps: frames / elapsed,
        segments: (timeline?.segments ?? []).map((s) => ({
          label: s.unit.label,
          kind: s.unit.kind,
          mid: s.start + s.blend + (s.to - s.from) / s.rate / 2,
        })),
        events: events.map((e) => ({ ...e, at: (e.at - start) / 1000 })),
      };
    }, gloss);
    // Segunda passada só para as capturas, no meio de cada sinal.
    const shots = [];
    const play = page.evaluate((gloss) => window.avatar.play(gloss), gloss);
    const t0 = Date.now();
    for (const [i, segment] of result.segments.entries()) {
      const wait = segment.mid * 1000 - (Date.now() - t0);
      if (wait > 0) await page.waitForTimeout(wait);
      const file = `${String(g + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}-${segment.label}.png`;
      await page.locator("canvas").screenshot({ path: join(out, file) });
      shots.push(file);
    }
    await play;
    report.push({ gloss, ...result, shots });
    console.log(
      `${gloss}\n  ${result.segments.map((s) => `${s.kind}:${s.label}`).join(" ")}\n` +
        `  planejado ${result.planned.toFixed(2)} s, real ${result.elapsed.toFixed(2)} s, ` +
        `${result.fps.toFixed(0)} fps`,
    );
    if (Math.abs(result.elapsed - result.planned) > 0.5 + result.planned * 0.1) {
      failures.push(`${gloss}: duração real ${result.elapsed} s, planejada ${result.planned} s`);
    }
  }
  await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(`Capturas e report.json em ${out}`);
} finally {
  await browser.close();
  await server.close();
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
