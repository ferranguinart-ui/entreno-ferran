import test from "node:test";
import assert from "node:assert/strict";
import { buildSteps } from "./timer.js";

const day = {
  id: 1,
  name: "Empuje",
  work_sec: 40,
  rest_ex_sec: 25,
  rest_round_sec: 90,
  exercises: [
    { id: 10, block: "main", name: "Press pecho", muscle_primary: "Pectoral" },
    { id: 11, block: "main", name: "Aperturas", muscle_primary: "Pectoral" },
    { id: 13, block: "main", name: "Rompe cráneos", muscle_primary: "Tríceps" },
    { id: 14, block: "remate", name: "Flexiones", work_sec: 40, is_optional: true },
  ],
};
const warm = [
  { name: "Jumping jacks", work_sec: 30 },
  { name: "Rotación hombros", work_sec: 20 },
];

test("secuencia principal: calentamiento + 3 rondas x 3 ejercicios", () => {
  const s = buildSteps(day, warm, { rounds: 3, remates: [] });
  assert.equal(s.filter((x) => x.kind === "warmup").length, 2);
  assert.equal(s.filter((x) => x.kind === "work").length, 9);
  assert.equal(s.at(-1).kind, "work", "no debe haber descanso final");
  assert.equal(s.at(-1).nextName, "Fin");
});

test("descansos: 25s entre ejercicios, 90s entre rondas", () => {
  const s = buildSteps(day, [], { rounds: 2, remates: [] });
  const rests = s.filter((x) => x.kind === "rest").map((x) => x.seconds);
  assert.deepEqual(rests, [25, 25, 90, 25, 25]); // r1: e-e, e-e, ronda; r2: e-e, e-e (sin cola)
});

test("calentamiento encadenado sin descansos", () => {
  const s = buildSteps(day, warm, { rounds: 1, remates: [] });
  assert.equal(s[0].seconds, 30);
  assert.equal(s[1].seconds, 20);
  assert.equal(s[2].kind, "work");
});

test("pasada de remate: prep + trabajo", () => {
  const r = buildSteps(day, [], { rounds: 0, remates: [day.exercises[3]] });
  assert.deepEqual(
    r.map((x) => `${x.kind}:${x.seconds}`),
    ["rest:25", "work:40"]
  );
});

test("override de trabajo por ejercicio", () => {
  const d2 = { ...day, exercises: [{ id: 99, block: "main", name: "X", work_sec: 20 }] };
  const s = buildSteps(d2, [], { rounds: 1, remates: [] });
  assert.equal(s[0].seconds, 20);
});
