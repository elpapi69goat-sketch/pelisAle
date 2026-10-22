// Pasa el audio decodificado a MP3 sin trabar la pantalla.
importScripts("https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js");

function toInt16(f) {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const s = Math.max(-1, Math.min(1, f[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

self.onmessage = ({ data }) => {
  try {
    const { channels, sampleRate, kbps } = data;
    const enc = new lamejs.Mp3Encoder(channels.length, sampleRate, kbps);
    const L = toInt16(channels[0]);
    const R = channels[1] ? toInt16(channels[1]) : null;
    const block = 1152 * 32;
    const parts = [];
    let last = 0;
    for (let i = 0; i < L.length; i += block) {
      const buf = R ? enc.encodeBuffer(L.subarray(i, i + block), R.subarray(i, i + block)) : enc.encodeBuffer(L.subarray(i, i + block));
      if (buf.length) parts.push(new Uint8Array(buf));
      const p = i / L.length;
      if (p - last > 0.02) { last = p; self.postMessage({ type: "progress", p }); }
    }
    const end = enc.flush();
    if (end.length) parts.push(new Uint8Array(end));
    self.postMessage({ type: "done", blob: new Blob(parts, { type: "audio/mpeg" }) });
  } catch (e) {
    self.postMessage({ type: "error", message: String((e && e.message) || e) });
  }
};
