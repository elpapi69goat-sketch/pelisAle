// Guionista: video → audio (MP3) → guión, todo dentro del navegador.

const $ = (s) => document.querySelector(s);
const state = { name: "audio", pcm16k: null, mp3: null, segments: [], asrBusy: false };

const fmtTime = (t) => {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0");
};
const fmtSize = (b) => (b > 1e9 ? (b / 1e9).toFixed(1) + " GB" : b > 1e6 ? (b / 1e6).toFixed(1) + " MB" : Math.round(b / 1e3) + " KB");
const baseName = (n) => n.replace(/\.[^.]+$/, "") || "audio";

let toastTimer = 0;
function toast(text) {
  const t = $("#toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
}

function meter(el, p, text, busy = false) {
  el.hidden = false;
  el.classList.toggle("busy", busy);
  el.querySelector("span").style.width = `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
  el.querySelector("em").textContent = text;
}

function showError(id, text) {
  const el = $(id);
  el.textContent = text;
  el.hidden = !text;
}

// ------------------------------------------------------------ 1 · video

$("#file").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (f) handleFile(f);
});
const drop = $("#drop");
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  const f = e.dataTransfer.files[0];
  if (f) handleFile(f);
});

async function handleFile(file) {
  if (state.asrBusy) return toast("Esperá a que termine el guión actual");
  state.name = baseName(file.name);
  state.pcm16k = null;
  state.mp3 = null;
  state.segments = [];
  $("#dropTitle").textContent = file.name;
  $("#dropSub").textContent = `${fmtSize(file.size)} · tocá para elegir otro`;
  showError("#err1", "");
  for (const id of ["#step2", "#step3", "#scriptWrap", "#claudeNote"]) $(id).hidden = true;

  let decoded;
  try {
    $("#step2").hidden = false;
    $("#audioMeta").textContent = "";
    $("#player").hidden = true;
    $("#audioActions").hidden = true;
    meter($("#mp3Meter"), 0.15, "Sacando el audio del video…", true);
    const buf = await file.arrayBuffer();
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    decoded = await ctx.decodeAudioData(buf);
    ctx.close?.();
  } catch (err) {
    $("#step2").hidden = true;
    showError("#err1", file.size > 1.5e9
      ? "El video es demasiado grande para procesarlo en el teléfono. Probá con uno más corto o recortalo antes."
      : "No pude leer el audio de este archivo. Probá con un video MP4 o MOV que tenga sonido.");
    return;
  }

  $("#audioMeta").textContent = `${fmtTime(decoded.duration)} · ${decoded.numberOfChannels === 1 ? "mono" : "estéreo"}`;
  drawWave(decoded);
  state.pcm16k = await toMono16k(decoded);
  $("#step3").hidden = false;
  encodeMp3(decoded);
}

// ------------------------------------------------------------ 2 · audio

function drawWave(buf) {
  const c = $("#wave");
  const dpr = Math.min(3, devicePixelRatio || 1);
  const W = c.clientWidth;
  const H = c.clientHeight;
  c.width = W * dpr;
  c.height = H * dpr;
  const g = c.getContext("2d");
  g.scale(dpr, dpr);
  const data = buf.getChannelData(0);
  const bars = Math.floor(W / 3);
  const step = Math.floor(data.length / bars) || 1;
  const peaks = [];
  for (let b = 0; b < bars; b++) {
    let max = 0;
    for (let i = b * step; i < (b + 1) * step && i < data.length; i += 8) max = Math.max(max, Math.abs(data[i]));
    peaks.push(max);
  }
  const top = Math.max(...peaks) || 1;
  g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--amber");
  peaks.forEach((p, b) => {
    const h = Math.max(2, (p / top) * (H - 12));
    g.fillRect(b * 3, (H - h) / 2, 2, h);
  });
}

async function toMono16k(buf) {
  const len = Math.ceil(buf.duration * 16000);
  const off = new OfflineAudioContext(1, len, 16000);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start();
  const out = await off.startRendering();
  return out.getChannelData(0);
}

function encodeMp3(buf) {
  // los audios largos van en mono para no llenar la memoria del teléfono
  const stereo = buf.numberOfChannels > 1 && buf.duration < 20 * 60;
  const channels = stereo ? [buf.getChannelData(0).slice(), buf.getChannelData(1).slice()] : [mixDown(buf)];
  const worker = new Worker("mp3-worker.js");
  meter($("#mp3Meter"), 0, "Armando el MP3…");
  worker.onmessage = ({ data }) => {
    if (data.type === "progress") meter($("#mp3Meter"), data.p, `Armando el MP3… ${Math.round(data.p * 100)}%`);
    if (data.type === "error") {
      meter($("#mp3Meter"), 0, "No se pudo armar el MP3");
      worker.terminate();
    }
    if (data.type === "done") {
      worker.terminate();
      state.mp3 = data.blob;
      const url = URL.createObjectURL(data.blob);
      $("#mp3Meter").hidden = true;
      const player = $("#player");
      player.src = url;
      player.hidden = false;
      const dl = $("#dlMp3");
      dl.href = url;
      dl.download = `${state.name}.mp3`;
      dl.textContent = `Descargar MP3 · ${fmtSize(data.blob.size)}`;
      const file = new File([data.blob], `${state.name}.mp3`, { type: "audio/mpeg" });
      $("#shareMp3").hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
      $("#shareMp3").onclick = () => navigator.share({ files: [file], title: `${state.name}.mp3` }).catch(() => {});
      $("#audioActions").hidden = false;
      $("#claudeNote").hidden = false;
    }
  };
  worker.postMessage({ channels, sampleRate: buf.sampleRate, kbps: stereo ? 128 : 96 }, channels.map((c) => c.buffer));
}

function mixDown(buf) {
  const out = new Float32Array(buf.length);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) out[i] += d[i] / buf.numberOfChannels;
  }
  return out;
}

// ------------------------------------------------------------ 3 · guión

let asrWorker = null;

$("#runAsr").addEventListener("click", () => {
  if (!state.pcm16k || state.asrBusy) return;
  state.asrBusy = true;
  state.segments = [];
  $("#runAsr").disabled = true;
  showError("#err3", "");
  $("#script").innerHTML = "";
  $("#slug").textContent = `GUION · ${state.name}`;
  $("#pageMeta").textContent = "Transcribiendo…";
  $("#scriptWrap").hidden = false;
  keepAwake();
  asrWorker ||= new Worker("asr-worker.js", { type: "module" });
  const m = $("#asrMeter");
  meter(m, 0, "Preparando…", true);
  const t0 = performance.now();
  asrWorker.onmessage = ({ data }) => {
    if (data.type === "status") meter(m, 0, data.text, true);
    if (data.type === "download") meter(m, data.loaded / data.total, `Bajando modelo · ${fmtSize(data.loaded)} / ${fmtSize(data.total)}`);
    if (data.type === "progress") {
      const p = data.done / data.total;
      const el = (performance.now() - t0) / 1000;
      const eta = p > 0.05 ? ` · faltan ~${fmtTime((el / p) * (1 - p))}` : "";
      meter(m, p, `Escuchando ${fmtTime(data.done)} de ${fmtTime(data.total)}${eta}`, p === 0);
    }
    if (data.type === "segment") addLine(data);
    if (data.type === "done") finishAsr(null);
    if (data.type === "error") finishAsr(data.message);
  };
  asrWorker.onerror = (e) => finishAsr(e.message || "error");
  asrWorker.postMessage({ audio: state.pcm16k.slice(), language: $("#lang").value, model: $("#model").value });
});

function addLine(seg) {
  state.segments.push(seg);
  const div = document.createElement("div");
  div.className = "line new";
  div.innerHTML = `<time contenteditable="false">${fmtTime(seg.start)}</time><p></p>`;
  div.querySelector("p").textContent = seg.text;
  $("#script").append(div);
}

function finishAsr(error) {
  state.asrBusy = false;
  $("#runAsr").disabled = false;
  releaseAwake();
  $("#asrMeter").hidden = true;
  if (error) {
    showError("#err3", `Se cortó la transcripción (${error}). Si el teléfono se quedó sin memoria, probá con la calidad "Rápida".`);
  }
  const n = state.segments.length;
  $("#pageMeta").textContent = n ? `${n} fragmentos · ${$("#lang").selectedOptions[0].text}` : "No se escuchó voz en el audio.";
  $("#runAsr").textContent = "Volver a sacar el guión";
  if (n && !error) toast("Guión listo");
  refreshDownloads();
}

// lo que el usuario corrigió a mano en la hoja manda sobre lo transcripto
function currentLines() {
  return [...$("#script").querySelectorAll(".line")].map((el, i) => ({
    ...state.segments[i],
    text: el.querySelector("p").textContent.trim(),
  }));
}

function srtTime(t) {
  const ms = Math.round((t % 1) * 1000);
  const s = Math.floor(t);
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function refreshDownloads() {
  const lines = currentLines();
  const txt = lines.map((l) => `[${fmtTime(l.start)}] ${l.text}`).join("\n") + "\n";
  const srt = lines.map((l, i) => `${i + 1}\n${srtTime(l.start)} --> ${srtTime(l.end)}\n${l.text}\n`).join("\n");
  const a = $("#dlTxt");
  const b = $("#dlSrt");
  URL.revokeObjectURL(a.href);
  URL.revokeObjectURL(b.href);
  a.href = URL.createObjectURL(new Blob([txt], { type: "text/plain;charset=utf-8" }));
  a.download = `${state.name} - guion.txt`;
  b.href = URL.createObjectURL(new Blob([srt], { type: "application/x-subrip;charset=utf-8" }));
  b.download = `${state.name}.srt`;
}
$("#script").addEventListener("input", () => {
  clearTimeout(refreshDownloads.t);
  refreshDownloads.t = setTimeout(refreshDownloads, 400);
});

$("#copyScript").addEventListener("click", async () => {
  const text = currentLines().map((l) => l.text).join("\n");
  try {
    await navigator.clipboard.writeText(text);
    toast("Guión copiado");
  } catch {
    const r = document.createRange();
    r.selectNodeContents($("#script"));
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    toast("Texto seleccionado: tocá Copiar");
  }
});

// la pantalla no se apaga mientras transcribe
let wake = null;
async function keepAwake() {
  try { wake = await navigator.wakeLock?.request("screen"); } catch {}
}
function releaseAwake() {
  try { wake?.release(); } catch {}
  wake = null;
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.asrBusy) keepAwake();
});
