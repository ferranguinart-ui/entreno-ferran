import test from "node:test";
import assert from "node:assert/strict";
import { PLATES, loadOptions, platesFor, platesText, stepLoad, progression } from "./plates.js";

test("PLATES: el material de Ferran", () => {
  assert.deepEqual(PLATES, [
    { kg: 2.5, n: 4 },
    { kg: 2, n: 4 },
    { kg: 1.5, n: 4 },
    { kg: 1.25, n: 5 },
  ]);
});

test("loadOptions: par de mancuernas → 16 pesos (por mancuerna), de 0 a 14,5", () => {
  const o = loadOptions("pair");
  assert.equal(o.length, 16);
  assert.deepEqual(o.slice(0, 6), [0, 2.5, 3, 4, 5, 5.5]);
  assert.equal(o.at(-1), 14.5);
});

test("loadOptions: una mancuerna o barra → todos los discos en una sola carga (hasta 29)", () => {
  const o = loadOptions("single");
  assert.equal(o.at(-1), 29);
  assert.ok(o.includes(6) && o.includes(8.5), "pasos de 0,5");
  assert.deepEqual(loadOptions("bar"), o);
});

test("loadOptions: peso corporal → sin opciones", () => {
  assert.deepEqual(loadOptions("bodyweight"), []);
  assert.deepEqual(loadOptions(null), []);
});

test("platesFor: discos por lado con el mínimo de discos", () => {
  assert.deepEqual(platesFor(8, "pair"), [{ kg: 2.5, count: 1 }, { kg: 1.5, count: 1 }]);
  assert.deepEqual(platesFor(5, "pair"), [{ kg: 2.5, count: 1 }]);
  assert.deepEqual(platesFor(0, "pair"), []);
  assert.equal(platesFor(6, "pair"), null, "6 kg no se puede montar en un par");
  assert.deepEqual(platesFor(10, "single"), [{ kg: 2.5, count: 2 }]);
});

test("platesText: texto legible por lado", () => {
  assert.equal(platesText(8, "pair"), "por lado: 2,5 + 1,5");
  assert.equal(platesText(10, "single"), "por lado: 2 × 2,5");
  assert.equal(platesText(0, "pair"), "sin discos");
  assert.equal(platesText(6, "pair"), "");
});

test("stepLoad: siguiente/anterior peso posible (y ajuste al más cercano)", () => {
  assert.equal(stepLoad(8, "pair", 1), 9);
  assert.equal(stepLoad(8, "pair", -1), 7.5);
  assert.equal(stepLoad(14.5, "pair", 1), 14.5, "tope");
  assert.equal(stepLoad(0, "pair", -1), 0);
  assert.equal(stepLoad(6, "pair", 1), 6.5, "desde un valor no montable sube al siguiente");
  assert.equal(stepLoad(null, "pair", 1), 2.5);
});

const ses = (kg, reps, deload = false) => ({ kg, reps, deload });

test("progression: sin historial → elegir peso", () => {
  assert.deepEqual(progression([], { equipment: "pair", rep_min: 10, rep_max: 14 }), { action: "start", kg: null });
});

test("progression: dos sesiones seguidas al máximo en todas las rondas → subir", () => {
  const h = [ses(8, [14, 14, 15]), ses(8, [14, 15, 14])];
  assert.deepEqual(progression(h, { equipment: "pair", rep_min: 10, rep_max: 14 }), { action: "up", kg: 9, from: 8 });
});

test("progression: solo una sesión al máximo → mantener", () => {
  const h = [ses(8, [14, 14, 14]), ses(8, [13, 12, 12])];
  assert.deepEqual(progression(h, { equipment: "pair", rep_min: 10, rep_max: 14 }), { action: "hold", kg: 8 });
});

test("progression: por debajo del mínimo dos sesiones seguidas → bajar", () => {
  const h = [ses(9, [9, 8, 8]), ses(9, [9, 9, 8])];
  assert.deepEqual(progression(h, { equipment: "pair", rep_min: 10, rep_max: 14 }), { action: "down", kg: 8, from: 9 });
});

test("progression: el deload no cuenta y la última sesión manda el peso", () => {
  const h = [ses(6.5, [10, 10], true), ses(8, [14, 14]), ses(8, [15, 14])];
  assert.deepEqual(progression(h, { equipment: "pair", rep_min: 10, rep_max: 14 }), { action: "up", kg: 9, from: 8 });
});

test("progression: si la sesión anterior fue con otro peso no cuenta para subir", () => {
  const h = [ses(8, [14, 14]), ses(7.5, [14, 14])];
  assert.deepEqual(progression(h, { equipment: "pair", rep_min: 10, rep_max: 14 }), { action: "hold", kg: 8 });
});

test("progression: sin rango (isométrico) o peso corporal → mantener lo último", () => {
  assert.deepEqual(progression([ses(4, [])], { equipment: "single", rep_min: null, rep_max: null }), { action: "hold", kg: 4 });
  assert.deepEqual(progression([ses(null, [20])], { equipment: "bodyweight" }), { action: "hold", kg: null });
});

import { targetsFor } from "./plates.js";

test("targetsFor: 'hoy toca' por ejercicio desde el historial del endpoint", () => {
  const exs = [
    { id: 12, equipment: "pair", rep_min: 10, rep_max: 14 },
    { id: 20, equipment: "bodyweight", rep_min: null, rep_max: null },
    { id: 11, equipment: "pair", rep_min: 12, rep_max: 16 },
  ];
  const last = {
    12: [
      { date: "2026-10-15", deload: false, kg: 8, rounds: [{ round: 1, reps: 14, kg: 8 }, { round: 2, reps: 14, kg: 8 }] },
      { date: "2026-10-08", deload: false, kg: 8, rounds: [{ round: 1, reps: 15, kg: 8 }, { round: 2, reps: null, kg: 8 }] },
    ],
  };
  const t = targetsFor(exs, last);
  assert.equal(t[12].action, "up");
  assert.equal(t[12].kg, 9);
  assert.equal(t[12].plates, "por lado: 2,5 + 2");
  assert.deepEqual(t[12].last, { date: "2026-10-15", kg: 8, reps: [14, 14] });
  assert.equal(t[20].action, "hold");
  assert.equal(t[20].kg, null);
  assert.equal(t[11].action, "start");
  assert.equal(t[11].last, null);
});

test("progression: si todo el historial es deload → elegir peso, con el kg del deload de referencia", () => {
  assert.deepEqual(progression([ses(6.5, [12], true)], { equipment: "pair", rep_min: 10, rep_max: 14 }), { action: "start", kg: 6.5 });
});

import { detectPRs } from "./plates.js";

test("detectPRs: peso máximo nuevo y más reps que nunca con un peso", () => {
  const records = {
    10: { max_kg: 8, reps_by_kg: { "8.0": 14, "7.5": 15 } },
    11: { max_kg: 5, reps_by_kg: { "5.0": 14 } },
    14: { max_kg: null, reps_by_kg: { 0: 20 } },
  };
  const logs = [
    { exercise_id: 10, round_number: 1, reps: 10, weight_kg: 9 }, // peso nuevo → récord de kg
    { exercise_id: 11, round_number: 1, reps: 15, weight_kg: 5 }, // 15 > 14 con 5 kg
    { exercise_id: 11, round_number: 2, reps: 16, weight_kg: 5 },
    { exercise_id: 14, round_number: 1, reps: 22, weight_kg: null }, // peso corporal
  ];
  assert.deepEqual(detectPRs(records, logs), [
    { exerciseId: 10, type: "kg", kg: 9, prev: 8 },
    { exerciseId: 11, type: "reps", kg: 5, reps: 16, prev: 14 },
    { exerciseId: 14, type: "reps", kg: null, reps: 22, prev: 20 },
  ]);
});

test("detectPRs: la primera vez no es récord; igualar tampoco", () => {
  const logs = [
    { exercise_id: 12, round_number: 1, reps: 12, weight_kg: 7.5 },
    { exercise_id: 11, round_number: 1, reps: 14, weight_kg: 5 },
  ];
  assert.deepEqual(detectPRs({ 11: { max_kg: 5, reps_by_kg: { "5.0": 14 } } }, logs), []);
});

test("detectPRs: claves de peso iguales a las de Python (4,75 no se confunde con 4,8)", () => {
  const records = { 30: { max_kg: 10, reps_by_kg: { "4.8": 30, "4.75": 10 } } };
  const logs = [{ exercise_id: 30, round_number: 1, reps: 12, weight_kg: 4.75 }];
  assert.deepEqual(detectPRs(records, logs), [{ exerciseId: 30, type: "reps", kg: 4.75, reps: 12, prev: 10 }]);
});

test("progression: muy por encima del rango en una sola sesión → subir ya", () => {
  const ex = { equipment: "pair", rep_min: 10, rep_max: 14 };
  // 18+ en todas las rondas (máximo + 4): no hace falta esperar a la segunda sesión
  assert.deepEqual(progression([ses(8, [24, 23, 18])], ex), { action: "up", kg: 9, from: 8 });
  assert.deepEqual(progression([ses(8, [24, 23, 18]), ses(7.5, [12, 12])], ex), { action: "up", kg: 9, from: 8 });
  // una ronda por debajo de máximo + 4 → regla normal (mantener)
  assert.deepEqual(progression([ses(8, [24, 23, 17])], ex), { action: "hold", kg: 8 });
  // el deload no cuenta para el salto
  assert.deepEqual(progression([ses(8, [30, 30], true), ses(8, [12, 12])], ex).action, "hold");
});

test("progression: el salto rápido necesita al menos 2 rondas apuntadas", () => {
  const ex = { equipment: "pair", rep_min: 10, rep_max: 14 };
  assert.deepEqual(progression([ses(8, [24])], ex), { action: "hold", kg: 8 });
});
