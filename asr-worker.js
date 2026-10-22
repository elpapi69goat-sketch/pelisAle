// Reconocimiento de voz con Whisper dentro del navegador (transformers.js).
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";

env.allowLocalModels = false;

const SR = 16000;
let asr = null;
let loadedModel = null;

const rms = (a) => {
  let s = 0;
  for (let i = 0; i < a.length; i += 4) s += a[i] * a[i];
  return Math.sqrt(s / (a.length / 4));
};

// Corta en el momento más silencioso de la ventana para no partir palabras.
function quietestCut(audio, from, to) {
  const frame = SR / 10;
  let best = to;
  let bestE = Infinity;
  for (let i = from; i + frame <= to; i += frame) {
    const e = rms(audio.subarray(i, i + frame));
    if (e < bestE) { bestE = e; best = i + frame / 2; }
  }
  return Math.floor(best);
}

async function load(model) {
  if (asr && loadedModel === model) return;
  const files = {};
  self.postMessage({ type: "status", text: "Bajando el modelo de voz…" });
  asr = await pipeline("automatic-speech-recognition", model, {
    device: "wasm",
    progress_callback: (p) => {
      if (p.status !== "progress" || !p.total) return;
      files[p.file] = p;
      let loaded = 0;
      let total = 0;
      for (const f of Object.values(files)) { loaded += f.loaded; total += f.total; }
      self.postMessage({ type: "download", loaded, total });
    },
  });
  loadedModel = model;
}

self.onmessage = async ({ data }) => {
  try {
    await load(data.model);
    const audio = data.audio;
    const total = audio.length / SR;
    self.postMessage({ type: "progress", done: 0, total });
    let start = 0;
    while (start < audio.length) {
      let end = Math.min(audio.length, start + 30 * SR);
      if (end < audio.length) end = quietestCut(audio, start + 24 * SR, end);
      const chunk = audio.subarray(start, end);
      // en los tramos en silencio Whisper inventa frases: los salteamos
      if (rms(chunk) > 0.004) {
        const out = await asr(chunk, {
          language: data.language || null,
          task: "transcribe",
          return_timestamps: true,
        });
        const pieces = out.chunks && out.chunks.length ? out.chunks : [{ timestamp: [0, null], text: out.text }];
        for (const c of pieces) {
          const text = (c.text || "").trim();
          if (!text) continue;
          const s = start / SR + (c.timestamp[0] ?? 0);
          const e = start / SR + (c.timestamp[1] ?? (end - start) / SR);
          self.postMessage({ type: "segment", start: s, end: e, text });
        }
      }
      start = end;
      self.postMessage({ type: "progress", done: start / SR, total });
    }
    self.postMessage({ type: "done" });
  } catch (e) {
    self.postMessage({ type: "error", message: String((e && e.message) || e) });
  }
};
