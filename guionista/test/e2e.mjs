// Prueba de punta a punta en un iPhone simulado:
// PW=<ruta a playwright> node guionista/test/e2e.mjs <video> <dir_capturas> [modelo] [idioma]
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PW);

const ROOT = new URL("..", import.meta.url).pathname;
const [video, OUT, model = "onnx-community/whisper-base", lang = "en"] = process.argv.slice(2);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((req, res) => {
  const f = join(ROOT, decodeURIComponent(req.url.split("?")[0]).replace(/\/$/, "/index.html"));
  if (!existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
  res.end(readFileSync(f));
}).listen(4322);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await (await browser.newContext({ ...devices["iPhone 14"] })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto("http://localhost:4322/");
await page.screenshot({ path: join(OUT, "g1-inicio.png") });
await page.setInputFiles("#file", video);
await page.waitForSelector("#audioActions:not([hidden])", { timeout: 120000 });
const mp3 = await page.evaluate(() => ({ size: state.mp3.size, type: state.mp3.type, dur: document.querySelector("#audioMeta").textContent }));
await page.screenshot({ path: join(OUT, "g2-audio.png") });
await page.selectOption("#model", model);
await page.selectOption("#lang", lang);
const t0 = Date.now();
await page.click("#runAsr");
await page.waitForTimeout(4000);
await page.screenshot({ path: join(OUT, "g3-trabajando.png") });
await page.waitForFunction(() => !state.asrBusy, null, { timeout: 900000 });
const secs = (Date.now() - t0) / 1000;
await page.screenshot({ path: join(OUT, "g4-guion.png"), fullPage: true });
const lines = await page.evaluate(() => currentLines().map((l) => `[${l.start.toFixed(1)}] ${l.text}`));
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
console.log({ mp3, secs, lines, overflow, errors });
await browser.close();
server.close();
