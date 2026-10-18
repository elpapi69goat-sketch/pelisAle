// Arma dist/index.html con el CSS y el JS adentro: node app/build.mjs
import { readFileSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = (f) => readFileSync(join(here, "src", f), "utf8");
const scripts = ["movies.js", "engine.js", "app.js"].map(src).join("\n\n");
const html = src("index.html")
  .replace("/*STYLES*/", () => src("styles.css"))
  .replace("/*SCRIPTS*/", () => scripts);
mkdirSync(join(here, "dist"), { recursive: true });
writeFileSync(join(here, "dist", "index.html"), html);
cpSync(join(here, "posters"), join(here, "dist", "posters"), { recursive: true });
console.log("dist/index.html", (html.length / 1024).toFixed(1), "KB");
