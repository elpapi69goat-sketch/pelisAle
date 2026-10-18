// Motor de duelos: decide qué par mostrar y calcula el ranking.
//
// Todo se deriva de la lista de respuestas, así que deshacer es sacar la
// última y retomar es volver a cargarla. Cada respuesta es [x, y, r]:
// r = 1 si gana x, -1 si gana y, 0 si es empate.
//
// Ronda 1 · Merge-insertion (Ford-Johnson): ≤136 duelos para 35 pelis,
//           a 3 del mínimo teórico (log2 35! ≈ 133).
// Ronda 2 · Verificación de vecinos: cada puesto contra el siguiente.
//           Si alguno se da vuelta, la peli sigue subiendo hasta su lugar.
// Ronda 3 · Dudas: empates, contradicciones y pares a dos puestos de
//           distancia que solo se conocían por transitividad, hasta ~200.

const Engine = (() => {
  const TARGET = 200;
  const MIN_DOUBTS = 20;
  const REACH_WEIGHT = 0.25;

  const key = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);

  function mulberry32(seed) {
    let t = seed >>> 0;
    return () => {
      t = (t + 0x6d2b79f5) >>> 0;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(ids, seed) {
    const rnd = mulberry32(seed);
    const out = ids.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  // Ford-Johnson como generador: hace `yield [x, y]` y recibe r.
  // Devuelve la lista de peor a mejor.
  function* mergeInsertion(xs) {
    const n = xs.length;
    if (n <= 1) return xs.slice();
    const winners = [];
    const partner = new Map();
    for (let i = 0; i + 1 < n; i += 2) {
      const r = yield [xs[i], xs[i + 1]];
      const [hi, lo] = r >= 0 ? [xs[i], xs[i + 1]] : [xs[i + 1], xs[i]];
      winners.push(hi);
      partner.set(hi, lo);
    }
    const sorted = yield* mergeInsertion(winners);
    const chain = [partner.get(sorted[0]), ...sorted];
    // pending[j] es b_{j+2}: el perdedor de cada ganador, acotado por él
    const pending = sorted.slice(1).map((hi) => ({ x: partner.get(hi), bound: hi }));
    if (n % 2) pending.push({ x: xs[n - 1], bound: null });

    // Orden de inserción por grupos de Jacobsthal: b3 b2, b5 b4, b11…b6, …
    const order = [];
    const jacobsthal = [1, 3, 5, 11, 21, 43, 85];
    let prev = 1;
    for (let k = 1; k < jacobsthal.length && prev < pending.length + 1; k++) {
      const top = Math.min(jacobsthal[k], pending.length + 1);
      for (let b = top; b > prev; b--) order.push(b - 2);
      prev = top;
    }

    for (const j of order) {
      const { x, bound } = pending[j];
      let lo = 0;
      let hi = bound === null ? chain.length : chain.indexOf(bound);
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const r = yield [x, chain[mid]];
        if (r > 0) lo = mid + 1;
        else if (r < 0) hi = mid;
        else lo = hi = mid + 1; // empate: queda pegada a esa peli
      }
      chain.splice(lo, 0, x);
    }
    return chain;
  }

  // Lee la respuesta i desde el punto de vista del par [x, y].
  // Devuelve null si no corresponde a ese par (estado viejo o corrupto).
  function orient(answer, x, y) {
    if (!answer) return null;
    const [a, b, r] = answer;
    if (a === x && b === y) return r;
    if (a === y && b === x) return -r;
    return null;
  }

  // Modelo con toda la evidencia: resultados directos + transitividad.
  function buildModel(ids, answers) {
    const n = ids.length;
    const idx = new Map(ids.map((id, i) => [id, i]));
    const net = Array.from({ length: n }, () => new Float64Array(n));
    const ties = new Map();
    answers.forEach(([a, b, r], i) => {
      const w = 1 + i * 1e-3; // a igualdad, pesa más la respuesta más nueva
      const ia = idx.get(a);
      const ib = idx.get(b);
      if (r === 0) {
        ties.set(key(a, b), (ties.get(key(a, b)) || 0) + 1);
        return;
      }
      const s = r > 0 ? w : -w;
      net[ia][ib] += s;
      net[ib][ia] -= s;
    });
    const reach = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => net[i][j] > 1e-9)
    );
    for (let k = 0; k < n; k++)
      for (let i = 0; i < n; i++)
        if (reach[i][k]) for (let j = 0; j < n; j++) if (reach[k][j]) reach[i][j] = true;

    const pref = (a, b) => {
      const i = idx.get(a);
      const j = idx.get(b);
      return net[i][j] + REACH_WEIGHT * ((reach[i][j] ? 1 : 0) - (reach[j][i] ? 1 : 0));
    };
    const direct = (a, b) => net[idx.get(a)][idx.get(b)];
    const tieCount = (a, b) => ties.get(key(a, b)) || 0;
    return { pref, direct, tieCount };
  }

  // Busca el orden que contradice la menor evidencia posible (Kemeny local),
  // empezando desde el orden de la ronda 1.
  function rank(base, model) {
    const order = base.slice();
    const n = order.length;
    for (let pass = 0; pass < 400; pass++) {
      let best = { delta: -1e-9, from: -1, to: -1 };
      for (let p = 0; p < n; p++) {
        const x = order[p];
        let delta = 0;
        for (let q = p - 1; q >= 0; q--) {
          delta -= model.pref(x, order[q]);
          if (delta < best.delta) best = { delta, from: p, to: q };
        }
        delta = 0;
        for (let q = p + 1; q < n; q++) {
          delta -= model.pref(order[q], x);
          if (delta < best.delta) best = { delta, from: p, to: q };
        }
      }
      if (best.from < 0) break;
      const [x] = order.splice(best.from, 1);
      order.splice(best.to, 0, x);
    }
    return order;
  }

  function pickDoubt(order, model, asked) {
    let best = null;
    for (let i = 0; i < order.length - 1; i++) {
      for (let gap = 1; gap <= 2 && i + gap < order.length; gap++) {
        const x = order[i];
        const y = order[i + gap];
        if (asked.has(key(x, y))) continue;
        const net = model.direct(x, y);
        if (model.tieCount(x, y) >= 2 && Math.abs(net) < 1e-6) continue; // empate confirmado
        const score = model.pref(x, y) + i * 0.004 + (gap - 1) * 0.05;
        if (!best || score < best.score) best = { score, pair: [x, y], slots: [i, i + gap] };
      }
    }
    return best;
  }

  // Estado completo a partir de las respuestas.
  // `fill(x, y)` es opcional: si las respuestas se acaban, se le pide una
  // (r o null) y se agrega a state.answers. Sirve para rehacer la historia
  // después de cambiar un duelo viejo sin volver a preguntar lo ya sabido.
  function plan(ids, state, fill) {
    const answers = state.answers;
    const result = (phase, pair, extra) => ({ phase, pair, answered: i, ...extra });
    let i = 0;
    const missing = ([x, y], phase) => {
      if (i < answers.length) return false;
      const r = fill ? fill(x, y, phase) : null;
      if (r === null || r === undefined) return true;
      answers.push([x, y, r]);
      return false;
    };

    // Ronda 1
    const gen = mergeInsertion(shuffle(ids, state.seed));
    let step = gen.next();
    while (!step.done) {
      const [x, y] = step.value;
      if (missing([x, y], 1)) return result(1, [x, y], { round: { done: i, total: null } });
      const r = orient(answers[i], x, y);
      if (r === null) return result(1, [x, y], { truncateTo: i, round: { done: i, total: null } });
      step = gen.next(r);
      i++;
    }
    const base = step.value.slice().reverse();
    const p1 = i;

    // Ronda 2
    const asked2 = new Set();
    let k = 0;
    for (;;) {
      const order = rank(base, buildModel(ids, answers.slice(0, i)));
      while (k < order.length - 1 && asked2.has(key(order[k], order[k + 1]))) k++;
      if (k >= order.length - 1) break;
      const pair = [order[k], order[k + 1]];
      const info = { p1, slots: [k, k + 1], round: { done: i - p1, total: ids.length - 1 } };
      if (missing(pair, 2)) return result(2, pair, info);
      const r = orient(answers[i], pair[0], pair[1]);
      if (r === null) return result(2, pair, { ...info, truncateTo: i });
      asked2.add(key(pair[0], pair[1]));
      i++;
      k = r < 0 ? Math.max(0, k - 1) : k + 1;
    }
    const p2 = i - p1;

    // Ronda 3
    const budget = Math.max(MIN_DOUBTS, TARGET - p1 - p2) + (state.extra || 0);
    const asked3 = new Set();
    let n3 = 0;
    while (n3 < budget) {
      const model = buildModel(ids, answers.slice(0, i));
      const order = rank(base, model);
      const doubt = pickDoubt(order, model, asked3);
      if (!doubt) break;
      const { pair, slots } = doubt;
      const info = { p1, p2, slots, round: { done: n3, total: budget } };
      if (missing(pair, 3)) return result(3, pair, info);
      const r = orient(answers[i], pair[0], pair[1]);
      if (r === null) return result(3, pair, { ...info, truncateTo: i });
      asked3.add(key(pair[0], pair[1]));
      i++;
      n3++;
    }

    const used = answers.slice(0, i);
    const model = buildModel(ids, used);
    const order = rank(base, model);
    return result("done", null, { p1, p2, p3: n3, order, base, truncateTo: i < answers.length ? i : undefined, ...stats(order, used, model) });
  }

  function stats(order, answers, model) {
    const record = new Map(order.map((id) => [id, { w: 0, l: 0, t: 0 }]));
    for (const [a, b, r] of answers) {
      if (r > 0) { record.get(a).w++; record.get(b).l++; }
      else if (r < 0) { record.get(b).w++; record.get(a).l++; }
      else { record.get(a).t++; record.get(b).t++; }
    }
    // empate que nada pudo desempatar: sin resultado directo ni camino
    const tiedWithNext = order.slice(0, -1).map((x, i) => {
      const y = order[i + 1];
      return model.tieCount(x, y) > 0 && Math.abs(model.pref(x, y)) < 1e-6;
    });
    const ties = answers.filter((a) => a[2] === 0).length;
    return { record, tiedWithNext, ties };
  }

  // Duelos estimados en total, para la barra de progreso.
  function estimateTotal(p) {
    if (p.phase === "done") return p.answered;
    if (p.phase === 3) return p.answered - p.round.done + p.round.total;
    return Math.max(TARGET, p.answered + 1);
  }

  // Cambia la respuesta `index` y rehace todo lo que vino después.
  // Reutiliza cada respuesta vieja cuyo par vuelva a aparecer y, en la
  // ronda 1, también lo que se deduce de tus otras respuestas (A>B y B>C
  // ⇒ A>C). Las rondas 2 y 3 verifican, así que ahí solo vale lo directo.
  function rewrite(ids, state, index, r) {
    const old = state.answers;
    const [x, y] = old[index];
    const memo = new Map();
    for (const [a, b, rr] of old.slice(index + 1)) {
      const k = key(a, b);
      if (!memo.has(k)) memo.set(k, []);
      memo.get(k).push(a < b ? rr : -rr);
    }
    const known = old.filter((_, i) => i !== index).concat([[x, y, r]]);
    const idx = new Map(ids.map((id, i) => [id, i]));
    const n = ids.length;
    const reach = Array.from({ length: n }, () => new Array(n).fill(false));
    for (const [a, b, rr] of known) {
      if (rr > 0) reach[idx.get(a)][idx.get(b)] = true;
      if (rr < 0) reach[idx.get(b)][idx.get(a)] = true;
    }
    for (let k = 0; k < n; k++)
      for (let i = 0; i < n; i++)
        if (reach[i][k]) for (let j = 0; j < n; j++) if (reach[k][j]) reach[i][j] = true;

    state.answers = old.slice(0, index).concat([[x, y, r]]);
    let reused = 0;
    const p = plan(ids, state, (a, b, phase) => {
      const q = memo.get(key(a, b));
      if (q && q.length) {
        reused++;
        const v = q.shift();
        return a < b ? v : -v;
      }
      if (phase !== 1) return null;
      const ab = reach[idx.get(a)][idx.get(b)];
      const ba = reach[idx.get(b)][idx.get(a)];
      if (ab === ba) return null;
      reused++;
      return ab ? 1 : -1;
    });
    return { plan: p, reused, dropped: old.length - index - 1 - reused };
  }

  // A qué ronda pertenece cada respuesta.
  function roundsOf(p, count) {
    return Array.from({ length: count }, (_, i) =>
      p.phase === 1 || i < p.p1 ? 1 : p.phase === 2 || i < p.p1 + p.p2 ? 2 : 3
    );
  }

  return { plan, rewrite, roundsOf, estimateTotal, mergeInsertion, TARGET, key };
})();

if (typeof module !== "undefined") module.exports = Engine;
