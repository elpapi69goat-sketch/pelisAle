// Simula usuarios y verifica el motor: node app/test/engine.test.js
const assert = require("assert");
const Engine = require("../src/engine.js");

const ids = Array.from({ length: 35 }, (_, i) => i + 1);

function run(truth, { noise = 0, tieGap = -1, seed = 7, rnd = Math.random } = {}) {
  const pos = new Map(truth.map((id, i) => [id, i]));
  const state = { seed, answers: [] };
  let p;
  for (let guard = 0; guard < 1000; guard++) {
    p = Engine.plan(ids, state);
    if (p.phase === "done") break;
    const [x, y] = p.pair;
    const gap = pos.get(y) - pos.get(x);
    let r = Math.abs(gap) <= tieGap ? 0 : gap > 0 ? 1 : -1;
    if (rnd() < noise) r = -r || 1;
    state.answers.push([x, y, r]);
  }
  return p;
}

// 1. Usuario consistente: orden exacto y presupuesto de duelos
for (let s = 1; s <= 20; s++) {
  const truth = ids.slice().sort(() => Math.random() - 0.5);
  const p = run(truth, { seed: s });
  assert.deepStrictEqual(p.order, truth, "orden exacto con respuestas consistentes");
  assert.ok(p.p1 <= 136, `ronda 1 con ${p.p1} duelos`);
  assert.strictEqual(p.p2, 34, "ronda 2 = 34 vecinos");
  assert.strictEqual(p.answered, Math.max(200, p.p1 + p.p2 + 20));
}
console.log("ok consistente");

// 2. Con ruido: siempre termina y el resultado se parece a la verdad
let worst = 0;
const t0 = Date.now();
for (let s = 1; s <= 20; s++) {
  const truth = ids.slice().sort(() => Math.random() - 0.5);
  const p = run(truth, { seed: s, noise: 0.05 });
  const pos = new Map(truth.map((id, i) => [id, i]));
  const disp = Math.max(...p.order.map((id, i) => Math.abs(pos.get(id) - i)));
  worst = Math.max(worst, disp);
  assert.strictEqual(p.order.length, 35);
}
console.log("ok ruido 5%, peor desplazamiento", worst, "ms/simulación", (Date.now() - t0) / 20);

// 3. Empates entre vecinos reales: se resuelven por transitividad
{
  const truth = ids.slice();
  const p = run(truth, { tieGap: 1 });
  console.log("empates", p.ties, "sin resolver", p.tiedWithNext.filter(Boolean).length, "duelos", p.answered);
  // con empates entre vecinos el orden puede quedar con pares adyacentes invertidos, nunca lejos
  const pos = new Map(truth.map((id, i) => [id, i]));
  const disp = Math.max(...p.order.map((id, i) => Math.abs(pos.get(id) - i)));
  assert.ok(disp <= 2, "desplazamiento " + disp);
}
// 4. Ejemplo del usuario: A y B empatan, A le gana a C y C le gana a B => A arriba de B
{
  const small = [1, 2, 3];
  const state = { seed: 1, answers: [] };
  const want = { "1-2": 0, "1-3": 1, "2-3": -1 }; // 1=A 2=B 3=C
  let p;
  for (let g = 0; g < 50; g++) {
    p = Engine.plan(small, state);
    if (p.phase === "done") break;
    const [x, y] = p.pair;
    const k = Engine.key(x, y);
    const r = x < y ? want[k] : -want[k];
    state.answers.push([x, y, r]);
  }
  assert.deepStrictEqual(p.order, [1, 3, 2]);
  console.log("ok empate desempatado por transitividad:", p.order.join(" > "));
}
// 5. Deshacer: quitar la última respuesta vuelve al mismo par
{
  const truth = ids.slice().reverse();
  const state = { seed: 3, answers: [] };
  for (let n = 0; n < 150; n++) {
    const p = Engine.plan(ids, state);
    const [x, y] = p.pair;
    state.answers.push([x, y, truth.indexOf(x) < truth.indexOf(y) ? 1 : -1]);
    const again = Engine.plan(ids, { seed: 3, answers: state.answers.slice(0, -1) });
    assert.deepStrictEqual(again.pair, p.pair);
  }
  console.log("ok deshacer");
}
