// Interfaz: intro → duelos (3 rondas) → revelación → ranking final.

const IDS = MOVIES.map((m) => m.id);
const BY_ID = new Map(MOVIES.map((m) => [m.id, m]));
const $ = (s) => document.querySelector(s);
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const LS_KEY = "pelisale-top35-v1";
const DB_PATH = "rankings/ale";
const PHASE_NAMES = { 1: "Ronda 1 · Ordenar", 2: "Ronda 2 · Verificar", 3: "Ronda 3 · Dudas" };

const wait = (ms) => new Promise((r) => setTimeout(r, REDUCED ? Math.min(ms, 60) : ms));
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ---------------------------------------------------------------- estado
// Se guarda en el teléfono (localStorage) y en la nube del artifact (db),
// así el progreso sobrevive aunque se borre uno de los dos.

function freshState() {
  return { seed: 1 + Math.floor(Math.random() * 2 ** 30), answers: [], extra: 0, revealed: false, updatedAt: 0 };
}
function encode(s) {
  return { seed: s.seed, answers: s.answers.map((a) => a.join(",")).join(";"), extra: s.extra, revealed: s.revealed, updatedAt: s.updatedAt };
}
function decode(o) {
  if (!o || typeof o.seed !== "number") return null;
  const answers = String(o.answers || "").split(";").filter(Boolean).map((t) => t.split(",").map(Number));
  if (answers.some((a) => a.length !== 3 || a.some(Number.isNaN))) return null;
  return { seed: o.seed, answers, extra: o.extra | 0, revealed: !!o.revealed, updatedAt: o.updatedAt || 0 };
}
function loadLocal() {
  try { return decode(JSON.parse(localStorage.getItem(LS_KEY))); } catch { return null; }
}

let state = loadLocal() || freshState();
let dbRef = null;
let writing = false;
let dirty = false;

function save() {
  state.updatedAt = Date.now();
  try { localStorage.setItem(LS_KEY, JSON.stringify(encode(state))); } catch {}
  dirty = true;
  flush();
}
async function flush() {
  if (!dbRef || writing || !dirty) return;
  writing = true;
  dirty = false;
  try { await dbRef.set(encode(state)); } catch {}
  writing = false;
  if (dirty) flush();
}
async function connectCloud() {
  const db = await window.claude?.use?.("db");
  if (!db) return;
  const ref = db.doc(DB_PATH);
  try {
    const snap = await ref.get();
    const remote = snap.exists ? decode(snap.data()) : null;
    dbRef = ref;
    if (remote && remote.updatedAt > state.updatedAt) {
      state = remote;
      try { localStorage.setItem(LS_KEY, JSON.stringify(encode(state))); } catch {}
      if (screen === "intro") updateIntro();
      else if (screen === "duel" && !busy) proceed(Engine.plan(IDS, state), false);
    } else if (state.answers.length) {
      dirty = true;
      flush();
    }
  } catch {}
}

// ---------------------------------------------------------------- pantallas

let screen = "intro";
function show(id) {
  for (const s of ["intro", "duel", "final"]) $("#" + s).hidden = s !== id;
  screen = id;
  window.scrollTo(0, 0);
}

let toastTimer = 0;
function toast(text) {
  const t = $("#toast");
  const info = text.length > 30;
  t.textContent = text;
  t.classList.toggle("info", info);
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), info ? 3200 : 1900);
}

let wakeLock = null;
async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {}
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && screen === "duel") keepAwake();
});

// ---------------------------------------------------------------- intro

function updateIntro() {
  const p = Engine.plan(IDS, state);
  const n = state.answers.length;
  const btn = $("#startBtn");
  if (p.phase === "done") btn.textContent = "Ver mi ranking";
  else if (n > 0) btn.textContent = `Seguir · duelo ${n + 1} de ~${Engine.estimateTotal(p)}`;
  else btn.textContent = "Empezar";
  $("#resetAsk").hidden = n === 0;
  $("#resetConfirm").hidden = true;
}

let heroIdx = 0;
setInterval(() => {
  if (screen !== "intro" || REDUCED) return;
  const img = $("#heroPoster");
  heroIdx = (heroIdx + 7) % MOVIES.length;
  img.style.opacity = 0;
  setTimeout(() => {
    img.src = MOVIES[heroIdx].poster;
    img.style.opacity = 1;
  }, 600);
}, 2600);

$("#startBtn").addEventListener("click", () => {
  const p = Engine.plan(IDS, state);
  if (p.phase === "done") return finish(p);
  show("duel");
  keepAwake();
  lastPhase = p.phase;
  proceed(p, true);
  if (p.round.done === 0) showTitleCard(p);
});
$("#resetAsk").addEventListener("click", () => {
  $("#resetAsk").hidden = true;
  $("#resetConfirm").hidden = false;
});
$("#resetNo").addEventListener("click", updateIntro);
$("#resetYes").addEventListener("click", () => {
  state = freshState();
  save();
  updateIntro();
  toast("Listo, arrancamos de cero");
});

// ---------------------------------------------------------------- carteles de episodio

const CARDS = {
  1: { ep: "The One With the 35 Movies", text: () => "Ronda 1 · Ordenar. Hasta 136 duelos. Cada respuesta descarta la mayor cantidad posible de órdenes." },
  2: { ep: "The One Where We Double-Check", text: () => "Ronda 2 · Verificar. Cada puesto contra el de abajo. Si alguna se da vuelta, sigue subiendo hasta encontrar su lugar." },
  3: { ep: "The One With All the Doubts", text: (p) => `Ronda 3 · Dudas. ${p.round.total} duelos para los empates y los pares más parejos.` },
};

function showTitleCard(p) {
  const c = CARDS[p.phase];
  const tc = $("#titlecard");
  tc.innerHTML = `<div class="inner">
    <div class="eyebrow">Temporada ${p.phase}</div>
    <div class="ep">${esc(c.ep)}</div>
    <div class="dots"><i></i><i></i><i></i></div>
    <p>${esc(c.text(p))}</p>
    <button class="btn" id="tcGo">Dale</button>
  </div>`;
  tc.hidden = false;
  $("#tcGo").focus({ preventScroll: true });
  $("#tcGo").addEventListener("click", () => { tc.hidden = true; }, { once: true });
}

// ---------------------------------------------------------------- duelos

let cur = null;
let busy = false;
let lastPhase = null;

function sideFlip(p) {
  // izquierda/derecha "al azar" pero reproducible, para no premiar un lado
  const h = Math.imul(state.seed ^ Math.imul(p.answered + 1, 2654435761), 1597334677) >>> 0;
  return (h >>> 15) & 1;
}

function fillCard(el, m) {
  el.classList.remove("win", "lose", "tie");
  el.querySelector(".mine").hidden = true;
  const img = el.querySelector("img");
  img.src = m.poster;
  img.alt = `Póster de ${m.title}`;
  el.querySelector(".yr").textContent = m.year;
  el.querySelector(".ttl").textContent = m.title;
  el.setAttribute("aria-label", `Elegir ${m.title} (${m.year})`);
}

function updateHeader(p) {
  const total = Engine.estimateTotal(p);
  const left = total - p.answered;
  $("#roundLabel").textContent = PHASE_NAMES[p.phase];
  $("#countLabel").textContent = `Duelo ${p.answered + 1} · ${p.phase === 3 ? "faltan " + left : "faltan ~" + left}`;
  const pct = (v) => `${Math.max(0, Math.min(100, v * 100))}%`;
  $("#bar1").style.width = p.phase > 1 ? "100%" : pct(Math.min(0.97, p.answered / 136));
  $("#bar2").style.width = p.phase > 2 ? "100%" : p.phase === 2 ? pct(p.round.done / p.round.total) : "0%";
  $("#bar3").style.width = p.phase === 3 ? pct(p.round.done / p.round.total) : "0%";
  const chalk = $("#chalk");
  if (p.phase === 2) chalk.textContent = `Verificando: puesto ${p.slots[0] + 1} vs ${p.slots[1] + 1}`;
  else if (p.phase === 3) chalk.textContent = `Could this BE any closer? · puestos ${p.slots[0] + 1} y ${p.slots[1] + 1}`;
  else chalk.textContent = p.answered === 0 ? "How you doin'?" : "";
  $("#undoBtn").disabled = state.answers.length === 0;
}

function fillDuel(p) {
  setEditing(null);
  const [x, y] = p.pair;
  const flip = sideFlip(p);
  cur = { x, y, L: flip ? y : x, R: flip ? x : y };
  fillCard($("#pickL"), BY_ID.get(cur.L));
  fillCard($("#pickR"), BY_ID.get(cur.R));
  updateHeader(p);
}

function dealIn() {
  const arena = $("#arena");
  arena.classList.add("back");
  arena.classList.remove("out", "in");
  void arena.offsetWidth;
  arena.classList.remove("back");
  arena.classList.add("in");
  setTimeout(() => arena.classList.remove("in"), 700);
}

function proceed(p, animate) {
  if (p.truncateTo !== undefined) {
    state.answers.length = p.truncateTo;
    save();
    p = Engine.plan(IDS, state);
  }
  if (p.phase === "done") {
    busy = false;
    return finish(p);
  }
  const changed = lastPhase !== null && lastPhase !== p.phase;
  lastPhase = p.phase;
  fillDuel(p);
  if (animate) dealIn();
  if (changed && p.round.done === 0) showTitleCard(p);
  busy = false;
}

const MILESTONES = {
  25: "How you doin'? · 25 duelos",
  50: "Oh. My. God. · ya van 50",
  100: "¡Mitad del camino!",
  150: "Could this BE any better? · 150",
  180: "Smelly Cat aprueba · 180",
};

async function answer(side) {
  if (busy || !cur || screen !== "duel" || !$("#titlecard").hidden || !$("#reveal").hidden || !$("#history").hidden) return;
  busy = true;
  const winner = side === "L" ? cur.L : side === "R" ? cur.R : null;
  const r = winner === null ? 0 : winner === cur.x ? 1 : -1;
  if (editIndex !== null) return applyEdit(side, r);
  state.answers.push([cur.x, cur.y, r]);
  save();

  const L = $("#pickL");
  const R = $("#pickR");
  if (side === "T") {
    L.classList.add("tie");
    R.classList.add("tie");
    if (!state.answers.slice(0, -1).some((a) => a[2] === 0)) toast("We were on a break!");
  } else {
    (side === "L" ? L : R).classList.add("win");
    (side === "L" ? R : L).classList.add("lose");
  }
  const next = Engine.plan(IDS, state);
  await wait(side === "T" ? 420 : 340);
  $("#arena").classList.add("out");
  await wait(250);
  if (MILESTONES[state.answers.length]) toast(MILESTONES[state.answers.length]);
  proceed(next, true);
}

function undo() {
  if (busy || !state.answers.length || editIndex !== null) return;
  state.answers.pop();
  save();
  const p = Engine.plan(IDS, state);
  if (screen !== "duel") {
    show("duel");
    keepAwake();
  }
  lastPhase = p.phase;
  fillDuel(p);
  dealIn();
  toast("PIVOT! · último duelo deshecho");
}

$("#pickL").addEventListener("click", () => answer("L"));
$("#pickR").addEventListener("click", () => answer("R"));
$("#tieBtn").addEventListener("click", () => answer("T"));
$("#undoBtn").addEventListener("click", undo);
$("#historyBtn").addEventListener("click", openHistory);
$("#editCancel").addEventListener("click", cancelEdit);
document.addEventListener("keydown", (e) => {
  if (screen !== "duel" || e.metaKey || e.ctrlKey) return;
  if (!$("#titlecard").hidden) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("#tcGo")?.click(); }
    return;
  }
  const k = e.key.toLowerCase();
  if (k === "arrowleft") answer("L");
  else if (k === "arrowright") answer("R");
  else if (k === "arrowdown") answer("T");
  else if (k === "z" || k === "backspace") undo();
  else if (k === "escape" && editIndex !== null) cancelEdit();
  else return;
  e.preventDefault();
});

// ---------------------------------------------------------------- historial: volver a un duelo y cambiarlo

let editIndex = null;

function setEditing(index) {
  editIndex = index;
  $("#editBar").hidden = index === null;
  $("#progress").hidden = index !== null;
  $("#tieBtn").classList.remove("chosen");
  $("#undoBtn").disabled = index !== null || state.answers.length === 0;
  if (index !== null) {
    $("#editLabel").textContent = `duelo ${index + 1}`;
    $("#chalk").textContent = "Elegí de nuevo. Después seguís desde donde te toca.";
  }
}

function roundsNow() {
  return Engine.roundsOf(Engine.plan(IDS, state), state.answers.length);
}

function openHistory() {
  if (busy || !state.answers.length) return toast("Todavía no hay duelos");
  const rounds = roundsNow();
  const names = { 1: "Ronda 1 · Ordenar", 2: "Ronda 2 · Verificar", 3: "Ronda 3 · Dudas" };
  const side = (id, cls) => {
    const m = BY_ID.get(id);
    return `<span class="hside ${cls}"><img src="${m.poster}" alt=""><span>${esc(m.title)}</span></span>`;
  };
  let html = "";
  let lastRound = 0;
  // del más nuevo al más viejo, agrupado por ronda
  for (let i = state.answers.length - 1; i >= 0; i--) {
    const [x, y, r] = state.answers[i];
    if (rounds[i] !== lastRound) {
      if (lastRound) html += `</div>`;
      lastRound = rounds[i];
      html += `<div class="hist-round r${lastRound}"><i></i>${names[lastRound]}</div><div class="hist-list">`;
    }
    const flip = sideFlip({ answered: i });
    const [L, R] = flip ? [y, x] : [x, y];
    const winner = r === 0 ? null : r > 0 ? x : y;
    const cls = (id) => (winner === null ? "" : winner === id ? "won" : "lost");
    html += `<button class="hrow" data-i="${i}" aria-label="Cambiar el duelo ${i + 1}">
      <span class="n">${i + 1}</span>${side(L, cls(L))}<span class="mid ${r === 0 ? "tie" : ""}">${r === 0 ? "≈" : "vs"}</span>${side(R, cls(R) + " right")}</button>`;
  }
  html += `</div>`;
  const h = $("#history");
  h.innerHTML = `<div class="history-in">
    <header class="history-head">
      <div class="row1"><h2>Historial</h2><button class="btn small ghost" id="histClose">Cerrar</button></div>
      <p>${state.answers.length} duelos. Tocá uno para cambiar tu elección; después seguís desde donde te toque.</p>
    </header>${html}</div>`;
  h.hidden = false;
  h.scrollTop = 0;
  document.body.style.overflow = "hidden";
  $("#histClose").addEventListener("click", closeHistory);
  h.querySelectorAll(".hrow").forEach((b) => b.addEventListener("click", () => {
    closeHistory();
    enterEdit(Number(b.dataset.i));
  }));
}

function closeHistory() {
  $("#history").hidden = true;
  document.body.style.overflow = "";
}

function enterEdit(index) {
  const [x, y, r] = state.answers[index];
  if (screen !== "duel") {
    show("duel");
    keepAwake();
  }
  const flip = sideFlip({ answered: index });
  cur = { x, y, L: flip ? y : x, R: flip ? x : y };
  fillCard($("#pickL"), BY_ID.get(cur.L));
  fillCard($("#pickR"), BY_ID.get(cur.R));
  setEditing(index);
  if (r === 0) $("#tieBtn").classList.add("chosen");
  else $(r > 0 === (cur.L === x) ? "#pickL" : "#pickR").querySelector(".mine").hidden = false;
  dealIn();
}

function cancelEdit() {
  if (busy) return;
  const p = Engine.plan(IDS, state);
  if (p.phase === "done") {
    setEditing(null);
    return showFinal(p, false);
  }
  lastPhase = p.phase;
  fillDuel(p);
  dealIn();
}

async function applyEdit(side, r) {
  const index = editIndex;
  const L = $("#pickL");
  const R = $("#pickR");
  if (side === "T") { L.classList.add("tie"); R.classList.add("tie"); }
  else { (side === "L" ? L : R).classList.add("win"); (side === "L" ? R : L).classList.add("lose"); }

  let p;
  let msg;
  if (state.answers[index][2] === r) {
    p = Engine.plan(IDS, state);
    msg = "Sin cambios: era la misma elección";
  } else {
    const res = Engine.rewrite(IDS, state, index, r);
    save();
    p = res.plan;
    const left = p.phase === "done" ? 0 : Engine.estimateTotal(p) - p.answered;
    msg = p.phase === "done" ? "Cambiado · ranking actualizado" : res.reused ? `Cambiado · ${res.reused} respuestas reutilizadas` : "Cambiado";
    if (p.phase !== "done" && left > 0) msg += ` · faltan ${left}`;
  }
  await wait(380);
  $("#arena").classList.add("out");
  await wait(250);
  setEditing(null);
  toast(msg);
  if (p.phase === "done" && state.revealed) {
    busy = false;
    cur = null;
    return showFinal(p, false);
  }
  lastPhase = p.phase;
  proceed(p, true);
}

// ---------------------------------------------------------------- confeti (los puntitos del logo)

function confetti() {
  if (REDUCED) return;
  const c = $("#confetti");
  const g = c.getContext("2d");
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = innerWidth;
  const H = innerHeight;
  c.width = W * dpr;
  c.height = H * dpr;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const colors = ["--dot-red", "--dot-yellow", "--dot-blue", "--gold-hi", "--cream"].map(css);
  const parts = [];
  for (let i = 0; i < 220; i++) {
    const left = i % 2 === 0;
    const a = (left ? -60 : -120) + (Math.random() - 0.5) * 40;
    const v = 11 + Math.random() * 13;
    parts.push({
      x: left ? -10 : W + 10,
      y: H * 0.78,
      vx: Math.cos((a * Math.PI) / 180) * v,
      vy: Math.sin((a * Math.PI) / 180) * v,
      r: 3 + Math.random() * 5,
      dot: Math.random() < 0.65,
      rot: Math.random() * 6,
      vr: (Math.random() - 0.5) * 0.3,
      color: colors[i % colors.length],
    });
  }
  const t0 = performance.now();
  (function frame(t) {
    g.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.32;
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      g.fillStyle = p.color;
      if (p.dot) {
        g.beginPath();
        g.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        g.fill();
      } else {
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.fillRect(-p.r, -p.r * 0.4, p.r * 2, p.r * 0.8);
        g.restore();
      }
    }
    if (t - t0 < 5000) requestAnimationFrame(frame);
    else g.clearRect(0, 0, W, H);
  })(t0);
}

// ---------------------------------------------------------------- revelación

function finish(p) {
  cur = null;
  try { wakeLock?.release(); } catch {}
  if (!state.revealed) {
    state.revealed = true;
    save();
    playReveal(p).then(() => showFinal(p, true));
  } else {
    showFinal(p, false);
  }
}

function recordText(rec) {
  const games = rec.w + rec.l + rec.t;
  const s = games === 1 ? "" : "s";
  return rec.t ? `ganó ${rec.w} y empató ${rec.t} de ${games} duelo${s}` : `ganó ${rec.w} de ${games} duelo${s}`;
}

async function playReveal(p) {
  const order = p.order;
  const R = $("#reveal");
  const S = $("#stage");
  R.hidden = false;
  document.body.style.overflow = "hidden";
  let skipped = false;
  const pending = [];
  const pause = (ms) => new Promise((res) => {
    if (skipped) return res();
    const t = setTimeout(res, REDUCED ? Math.min(ms, 400) : ms);
    pending.push(() => { clearTimeout(t); res(); });
  });
  $("#skipBtn").hidden = false;
  $("#skipBtn").onclick = () => {
    skipped = true;
    pending.splice(0).forEach((f) => f());
  };
  const m = (rank) => BY_ID.get(order[rank - 1]);

  S.innerHTML = `<div class="eyebrow">Episodio final</div><div class="drum">The One With the Ranking</div><div class="dots-row"><i></i><i></i><i></i></div>`;
  await pause(2000);

  if (!skipped) {
    S.innerHTML = `<div class="stage-label">Del 35 al 11</div><div class="ticker"></div>`;
    const tk = S.querySelector(".ticker");
    for (let r = 35; r >= 11 && !skipped; r--) {
      const mv = m(r);
      const row = document.createElement("div");
      row.className = "tick";
      row.innerHTML = `<span class="rk">${r}</span><img src="${mv.poster}" alt=""><span class="t">${esc(mv.title)}</span>`;
      tk.prepend(row);
      while (tk.children.length > 8) tk.lastChild.remove();
      await pause(r > 15 ? 150 : 320);
    }
    await pause(700);
  }

  for (let r = 10; r >= 4 && !skipped; r--) {
    const mv = m(r);
    S.innerHTML = `<div class="stage-label">Top 10</div>
      <div class="bigcard"><div class="num">${r}</div><img src="${mv.poster}" alt=""><div class="t">${esc(mv.title)}</div><div class="rkl">${mv.year}</div></div>`;
    await pause(r > 6 ? 1150 : 1450);
  }

  for (const r of [3, 2]) {
    if (skipped) break;
    const mv = m(r);
    S.innerHTML = `<div class="stage-label">El podio</div>
      <div class="bigcard medal"><div class="num">${r}</div><img src="${mv.poster}" alt=""><span class="medal-chip ${r === 3 ? "bronze" : ""}">${r === 3 ? "Bronce" : "Plata"}</span><div class="t">${esc(mv.title)}</div></div>`;
    await pause(2000);
  }

  if (!skipped) {
    S.innerHTML = `<div class="drum">Y tu número 1 es<span class="d">.</span><span class="d">.</span><span class="d">.</span></div>`;
    await pause(2200);
  }

  if (!skipped) {
    const mv = m(1);
    S.innerHTML = `<div class="door-scene"><div class="behind"><div class="rays"></div><div class="frame"><img src="${mv.poster}" alt="Póster de ${esc(mv.title)}"></div></div>
        <div class="door"><div class="peep"></div><div class="knob"></div></div></div>
      <div class="winner-title reveal-in" style="animation-delay:1.2s">${esc(mv.title)}</div>
      <div class="reveal-in" style="animation-delay:1.45s;color:var(--muted)">${mv.year} · ${recordText(p.record.get(mv.id))}</div>
      <button class="btn reveal-in" id="toFinal" style="animation-delay:1.9s">Ver mi ranking completo</button>`;
    await pause(450);
    S.querySelector(".door-scene").classList.add("open");
    await pause(650);
    if (!skipped) confetti();
    $("#skipBtn").hidden = true;
    await new Promise((res) => {
      $("#toFinal").onclick = res;
      pending.push(res);
    });
  }
  R.hidden = true;
  S.innerHTML = "";
  document.body.style.overflow = "";
}

// ---------------------------------------------------------------- ranking final

function deltaHtml(id, rank) {
  const d = id - rank; // id = puesto en la lista de Letterboxd
  const title = `En tu lista de Letterboxd estaba #${id}`;
  if (d > 0) return `<div class="delta up" title="${title}">▲ ${d}</div>`;
  if (d < 0) return `<div class="delta down" title="${title}">▼ ${-d}</div>`;
  return `<div class="delta" title="${title}">=</div>`;
}

function rowHtml(p, rank) {
  const mv = BY_ID.get(p.order[rank - 1]);
  const rec = p.record.get(mv.id);
  return `<div class="row"><div class="rk">${rank}</div><img src="${mv.poster}" alt="">
    <div class="info"><div class="t">${esc(mv.title)}</div><div class="s">${mv.year} · ${rec.w}-${rec.l}${rec.t ? "-" + rec.t : ""}</div></div>
    ${deltaHtml(mv.id, rank)}</div>${p.tiedWithNext[rank - 1] && rank < 35 ? `<div class="tie-note">≈ empate técnico con la de abajo</div>` : ""}`;
}

function rowsHtml(p, from, to) {
  let h = "";
  for (let r = from; r <= to; r++) h += rowHtml(p, r);
  return h;
}

function showFinal(p, celebrate) {
  show("final");
  const F = $("#final");
  const o = p.order;
  const champ = BY_ID.get(o[0]);
  const climbs = o.map((id, i) => ({ id, d: id - (i + 1) })).sort((a, b) => b.d - a.d);
  const climb = climbs[0];
  const podTie = p.tiedWithNext[0] && p.tiedWithNext[1] ? "1º, 2º y 3º" : p.tiedWithNext[0] ? "1º y 2º" : p.tiedWithNext[1] ? "2º y 3º" : "";
  const spot = (rank) => {
    const mv = BY_ID.get(o[rank - 1]);
    return `<div class="spot"><span class="medal-chip ${rank === 3 ? "bronze" : ""}">${rank === 2 ? "Plata · 2º" : "Bronce · 3º"}</span>
      <img src="${mv.poster}" alt="Póster de ${esc(mv.title)}"><div class="t">${esc(mv.title)}</div><small>${mv.year} · ${recordText(p.record.get(mv.id))}</small></div>`;
  };

  F.innerHTML = `
    <header class="final-head">
      <div class="eyebrow">The One With Ale's Top 35</div>
      <h1 class="logo" aria-label="Top 35">T<i></i>O<i></i>P<i></i>3<i></i>5</h1>
    </header>
    <section class="champion">
      <div class="rays" aria-hidden="true"></div>
      <div class="frame"><span class="crown">Nº 1</span><img src="${champ.poster}" alt="Póster de ${esc(champ.title)}"></div>
      <h2>${esc(champ.title)}</h2>
      <div class="meta">${champ.year} · ${recordText(p.record.get(champ.id))} · en Letterboxd estaba #${champ.id}</div>
    </section>
    <section class="podium">${spot(2)}${spot(3)}</section>
    ${podTie ? `<div class="tie-note" style="border:0;margin-top:10px">≈ ${podTie} quedaron en empate técnico</div>` : ""}
    <section class="stats">
      <div class="stat"><b>${p.answered}</b><span>duelos 1 contra 1</span></div>
      <div class="stat"><b>${p.ties}</b><span>empates</span></div>
      <div class="stat"><b class="up">▲ ${Math.max(0, climb.d)}</b><span>${climb.d > 0 ? "subió " + esc(BY_ID.get(climb.id).title) : "nada subió"}</span></div>
    </section>
    <div class="list-title"><h3>Top 10</h3></div>
    <div class="rows">${rowsHtml(p, 4, 10)}</div>
    <div class="list-title"><h3>Del 11 al 35</h3></div>
    <div class="rows compact">${rowsHtml(p, 11, 35)}</div>
    <p class="legend">▲▼ cuántos puestos cambió cada peli respecto de tu lista de Letterboxd · 9-2-1 son duelos ganados, perdidos y empatados.</p>
    <section class="actions">
      <button class="btn" id="storyBtn">Guardar imagen del Top 10</button>
      <button class="btn ghost" id="copyBtn">Copiar el ranking como texto</button>
      <button class="btn ghost" id="moreBtn">Hacer 10 duelos más de desempate</button>
      <button class="btn ghost" id="replayBtn">Ver la revelación otra vez</button>
      <button class="btn ghost" id="histFinalBtn">Revisar o cambiar duelos</button>
      <button class="linkish" id="finalReset">Empezar de cero</button>
      <div id="finalConfirm" class="confirm" hidden>
        <span>¿Borrar todos los duelos y el ranking?</span>
        <div><button id="finalResetYes" class="btn small">Sí, borrar</button><button id="finalResetNo" class="btn small ghost">Cancelar</button></div>
      </div>
    </section>`;

  // las filas que todavía no se ven entran con una animación suave al scrollear
  if ("IntersectionObserver" in window && !REDUCED) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add("seen"); io.unobserve(e.target); }
    });
    requestAnimationFrame(() => {
      F.querySelectorAll(".row").forEach((r) => {
        if (r.getBoundingClientRect().top > innerHeight) io.observe(r);
      });
    });
  }

  $("#storyBtn").addEventListener("click", () => openStory(p));
  $("#copyBtn").addEventListener("click", () => copyRanking(p));
  $("#moreBtn").addEventListener("click", () => {
    state.extra += 10;
    save();
    const np = Engine.plan(IDS, state);
    if (np.phase === "done") return toast("No quedan pares dudosos para revisar");
    show("duel");
    keepAwake();
    lastPhase = np.phase;
    proceed(np, true);
  });
  $("#replayBtn").addEventListener("click", () => playReveal(p).then(() => window.scrollTo(0, 0)));
  $("#histFinalBtn").addEventListener("click", openHistory);
  $("#finalReset").addEventListener("click", () => { $("#finalReset").hidden = true; $("#finalConfirm").hidden = false; });
  $("#finalResetNo").addEventListener("click", () => { $("#finalReset").hidden = false; $("#finalConfirm").hidden = true; });
  $("#finalResetYes").addEventListener("click", () => {
    state = freshState();
    save();
    show("intro");
    updateIntro();
  });

  if (celebrate) setTimeout(confetti, 250);
}

function rankingText(p) {
  const lines = p.order.map((id, i) => `${i + 1}. ${BY_ID.get(id).title} (${BY_ID.get(id).year})`);
  return `Mi Top 35 · ${p.answered} duelos 1 contra 1\n\n${lines.join("\n")}`;
}

function copyRanking(p) {
  const text = rankingText(p);
  const fallback = () => {
    openSheet(`<p>Seleccioná el texto y copialo:</p><textarea id="copyArea" readonly style="width:100%;height:50vh;border-radius:12px;padding:12px;background:var(--wall-2);color:var(--cream);border:0;font:14px/1.5 var(--body)">${esc(text)}</textarea><button class="btn ghost small" id="sheetClose">Cerrar</button>`);
    const ta = $("#copyArea");
    ta.focus();
    ta.select();
  };
  try {
    navigator.clipboard.writeText(text).then(() => toast("Ranking copiado"), fallback);
  } catch {
    fallback();
  }
}

function openSheet(html) {
  const sh = $("#sheet");
  sh.innerHTML = `<div class="inner">${html}</div>`;
  sh.hidden = false;
  sh.onclick = (e) => {
    if (e.target === sh || e.target.id === "sheetClose") sh.hidden = true;
  };
}

// ---------------------------------------------------------------- imagen para historias

function loadImg(src) {
  return new Promise((res) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => res(null);
    i.src = src;
  });
}

function wrap(g, text, maxW) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; }
    else line = t;
  }
  lines.push(line);
  return lines;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function drawPoster(g, img, x, y, w, h, r) {
  g.save();
  roundRect(g, x, y, w, h, r);
  g.clip();
  if (img) g.drawImage(img, x, y, w, h);
  g.restore();
}

async function makeStory(p) {
  await document.fonts.ready;
  const DISPLAY = css("--display");
  const BODY = css("--body");
  const c = document.createElement("canvas");
  c.width = 1080;
  c.height = 1920;
  const g = c.getContext("2d");
  const imgs = await Promise.all(p.order.slice(0, 10).map((id) => loadImg(BY_ID.get(id).poster)));

  const bg = g.createLinearGradient(0, 0, 0, 1920);
  bg.addColorStop(0, css("--wall-3"));
  bg.addColorStop(0.45, css("--wall"));
  bg.addColorStop(1, css("--ink"));
  g.fillStyle = bg;
  g.fillRect(0, 0, 1080, 1920);

  // logo T·O·P·3·5
  g.textBaseline = "alphabetic";
  g.font = `800 150px ${DISPLAY}`;
  const letters = ["T", "O", "P", "3", "5"];
  const dots = ["--dot-red", "--dot-yellow", "--dot-blue", "--dot-red"].map(css);
  const gap = 34;
  const widths = letters.map((l) => g.measureText(l).width);
  let x = (1080 - (widths.reduce((a, b) => a + b) + gap * 4)) / 2;
  letters.forEach((l, i) => {
    g.fillStyle = css("--cream");
    g.fillText(l, x, 230);
    x += widths[i];
    if (i < 4) {
      g.fillStyle = dots[i];
      g.beginPath();
      g.arc(x + gap / 2, 185, 11, 0, Math.PI * 2);
      g.fill();
      x += gap;
    }
  });
  g.font = `700 30px ${BODY}`;
  g.fillStyle = css("--muted");
  g.textAlign = "center";
  g.fillText("THE ONE WITH ALE'S TOP 35", 540, 110);
  g.textAlign = "left";

  // Nº 1 en el marco dorado
  const fx = 90, fy = 320, fw = 400, fh = 588;
  const gold = g.createLinearGradient(fx, fy, fx + fw, fy + fh);
  gold.addColorStop(0, css("--gold-hi"));
  gold.addColorStop(0.3, css("--gold"));
  gold.addColorStop(0.5, css("--gold-hi"));
  gold.addColorStop(0.75, css("--gold-lo"));
  gold.addColorStop(1, css("--gold"));
  g.fillStyle = gold;
  roundRect(g, fx, fy, fw, fh, 26);
  g.fill();
  drawPoster(g, imgs[0], fx + 16, fy + 16, fw - 32, fh - 32, 14);

  const champ = BY_ID.get(p.order[0]);
  g.fillStyle = css("--gold-hi");
  g.font = `800 64px ${DISPLAY}`;
  g.fillText("Nº 1", 540, 400);
  g.fillStyle = css("--cream");
  g.font = `800 78px ${DISPLAY}`;
  const tl = wrap(g, champ.title, 460).slice(0, 4);
  tl.forEach((l, i) => g.fillText(l, 540, 500 + i * 84));
  g.font = `500 32px ${BODY}`;
  g.fillStyle = css("--muted");
  g.fillText(`${champ.year} · ${recordText(p.record.get(champ.id))}`, 540, 500 + tl.length * 84 + 20);

  // 2 al 10 en dos columnas
  const top = 990;
  for (let r = 2; r <= 10; r++) {
    const col = r <= 6 ? 0 : 1;
    const row = col === 0 ? r - 2 : r - 7;
    const cx = 70 + col * 480;
    const cy = top + row * 168;
    g.fillStyle = css("--gold-hi");
    g.font = `800 56px ${DISPLAY}`;
    g.textAlign = "right";
    g.fillText(String(r), cx + 66, cy + 78);
    g.textAlign = "left";
    drawPoster(g, imgs[r - 1], cx + 84, cy, 96, 144, 8);
    g.fillStyle = css("--cream");
    g.font = `700 32px ${DISPLAY}`;
    const lines = wrap(g, BY_ID.get(p.order[r - 1]).title, 250).slice(0, 3);
    const y0 = cy + 72 - ((lines.length - 1) * 36) / 2;
    lines.forEach((l, i) => g.fillText(l, cx + 200, y0 + i * 36));
  }

  g.textAlign = "center";
  g.font = `600 28px ${BODY}`;
  g.fillStyle = css("--faint");
  g.fillText(`${p.answered} duelos 1 contra 1 · ranking completo de 35 pelis`, 540, 1860);
  return new Promise((res) => c.toBlob(res, "image/png"));
}

async function openStory(p) {
  openSheet(`<p>Armando la imagen…</p>`);
  const blob = await makeStory(p);
  if (!blob) return openSheet(`<p>No se pudo generar la imagen.</p><button class="btn ghost small" id="sheetClose">Cerrar</button>`);
  const url = URL.createObjectURL(blob);
  openSheet(`<img src="${url}" alt="Imagen con tu Top 10">
    <p>Mantené apretada la imagen para guardarla en Fotos.</p>
    <button class="btn small" id="saveImg" hidden>Guardar archivo</button>
    <button class="btn ghost small" id="sheetClose">Cerrar</button>`);
  const dl = await window.claude?.use?.("downloads");
  const btn = $("#saveImg");
  if (dl && btn) {
    btn.hidden = false;
    btn.onclick = async () => {
      try { await dl.save({ filename: "top-35-ale.png", data: blob }); }
      catch (e) { if (e?.code !== "declined") toast("No se pudo guardar el archivo"); }
    };
  }
}

// ---------------------------------------------------------------- arranque

for (const m of MOVIES) new Image().src = m.poster;
updateIntro();
connectCloud();
