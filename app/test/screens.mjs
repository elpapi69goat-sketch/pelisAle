// Recorre la app en un iPhone simulado y saca capturas: node app/test/screens.mjs <dir_salida>
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";
const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PW || "playwright");

const DIST = new URL("../dist/", import.meta.url).pathname;
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const server = createServer((req, res) => {
  const f = join(DIST, decodeURIComponent(req.url.split("?")[0]).replace(/^\/$/, "/index.html"));
  if (!existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": { ".html": "text/html; charset=utf-8", ".jpg": "image/jpeg" }[extname(f)] || "application/octet-stream" });
  res.end(readFileSync(f));
}).listen(4321);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ ...devices["iPhone 14"] });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && !m.text().includes("fonts") && errors.push(m.text()));
const shot = (n) => page.screenshot({ path: join(OUT, n + ".png") });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// respuestas de un "usuario" con gustos parecidos a su lista de Letterboxd
async function seed(count, revealed = false, untilPhase = 0) {
  await page.evaluate(([count, revealed, untilPhase]) => {
    const taste = new Map(MOVIES.map((m) => [m.id, m.id + ((m.id * 7919) % 11) - 5]));
    const s = { seed: 12345, answers: [], extra: 0, revealed, updatedAt: Date.now() };
    for (let i = 0; i < count; i++) {
      const p = Engine.plan(IDS, s);
      if (p.phase === "done" || (untilPhase && p.phase === untilPhase && p.round.done >= 3)) break;
      const [x, y] = p.pair;
      const d = taste.get(y) - taste.get(x);
      s.answers.push([x, y, Math.abs(d) < 0.5 ? 0 : d > 0 ? 1 : -1]);
    }
    localStorage.setItem("pelisale-top35-v1", JSON.stringify({ ...s, answers: s.answers.map((a) => a.join(",")).join(";") }));
  }, [count, revealed, untilPhase]);
  await page.reload();
}

await page.goto("http://localhost:4321/");
await sleep(500);
await shot("01-intro");
await page.click("#startBtn");
await sleep(1200);
await shot("02-titlecard");
await page.click("#tcGo");
await sleep(300);
await shot("03-duelo");
await page.click("#pickL");
await sleep(200);
await shot("04-eleccion");
await sleep(900);
await page.click("#tieBtn");
await sleep(150);
await shot("05-empate");

await seed(140);
await page.click("#startBtn");
await sleep(800);
await shot("06-ronda2");
await seed(400, false, 3);
await page.click("#startBtn");
await sleep(800);
await shot("07-ronda3");
await page.click("#historyBtn");
await sleep(400);
await shot("07b-historial");
await page.click('.hrow[data-i="40"]');
await sleep(800);
await shot("07c-editar");
const before = await page.evaluate(() => state.answers.length);
await page.click(await page.isVisible("#pickL .mine:not([hidden])") ? "#pickR" : "#pickL");
await sleep(900);
await shot("07d-despues");
console.log("cambio duelo 41:", before, "respuestas →", await page.evaluate(() => state.answers.length), "| pantalla:", await page.evaluate(() => screen), "| editando:", await page.evaluate(() => editIndex));

await seed(400);
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("pelisale-top35-v1"));
  s.answers = s.answers.split(";").slice(0, -1).join(";");
  localStorage.setItem("pelisale-top35-v1", JSON.stringify(s));
});
await page.reload();
await page.click("#startBtn");
await sleep(600);
if (await page.isVisible("#tcGo")) await page.click("#tcGo");
const t0 = Date.now();
await page.click("#pickL");
for (const [ms, n] of [[1500, "08-rev-titulo"], [5000, "09-rev-ticker"], [10000, "10-rev-top10"], [18500, "11-rev-podio"], [21300, "12-rev-redoble"], [25200, "13-rev-puerta"]]) {
  await sleep(Math.max(0, ms - (Date.now() - t0)));
  await shot(n);
}
await page.click("#toFinal");
await sleep(1500);
await shot("14-final");
await page.screenshot({ path: join(OUT, "15-final-completo.png"), fullPage: true });
await page.click("#storyBtn");
await sleep(2500);
await shot("16-imagen");
const story = await page.evaluate(async () => {
  const p = Engine.plan(IDS, state);
  const b = await makeStory(p);
  const r = new FileReader();
  return await new Promise((res) => { r.onload = () => res(r.result); r.readAsDataURL(b); });
});
(await import("node:fs")).writeFileSync(join(OUT, "17-story.png"), Buffer.from(story.split(",")[1], "base64"));
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
console.log("overflow horizontal:", overflow, "errores:", errors);
await browser.close();
server.close();
