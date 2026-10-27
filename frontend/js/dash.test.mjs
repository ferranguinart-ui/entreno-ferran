import test from "node:test";
import assert from "node:assert/strict";
import {
  movingAvg,
  withAvg,
  deltaOver,
  goalProgress,
  monthCounts,
  bestWeekStreak,
  heatWeeks,
  strengthByDay,
  inRange,
  sparkPath,
} from "./dash.js";

test("movingAvg: media de las últimas n (ventana creciente al principio)", () => {
  assert.deepEqual(movingAvg([1, 2, 3, 4], 2), [1, 1.5, 2.5, 3.5]);
  assert.deepEqual(movingAvg([], 7), []);
});

test("withAvg: puntos ordenados con su media móvil", () => {
  const p = withAvg([{ date: "2026-10-02", y: 74 }, { date: "2026-10-01", y: 76 }], 7);
  assert.deepEqual(p.map((x) => [x.date, x.avg]), [["2026-10-01", 76], ["2026-10-02", 75]]);
});

test("deltaOver: media actual menos la media de hace ~30 días", () => {
  const pts = withAvg(
    [
      { date: "2026-09-01", y: 76 },
      { date: "2026-09-15", y: 75 },
      { date: "2026-10-15", y: 73 },
    ],
    1
  );
  assert.equal(deltaOver(pts, "2026-10-15", 30), -2); // 73 - 75 (último punto ≤ 15-sep)
  assert.equal(deltaOver(pts.slice(2), "2026-10-15", 30), null, "sin histórico suficiente");
  assert.equal(deltaOver([], "2026-10-15", 30), null);
});

test("goalProgress: lo que falta y % del camino desde el primer registro", () => {
  assert.deepEqual(goalProgress(76, 73, 70), { remaining: 3, pct: 50 });
  assert.deepEqual(goalProgress(76, 69.5, 70), { remaining: 0, pct: 100 });
  assert.deepEqual(goalProgress(76, 77, 70), { remaining: 7, pct: 0 });
  assert.equal(goalProgress(null, 73, 70), null);
});

test("monthCounts: sesiones de este mes y del anterior (cruza año)", () => {
  const s = (date) => ({ date });
  const r = monthCounts([s("2026-01-03"), s("2026-01-05"), s("2025-12-30")], "2026-01-20");
  assert.deepEqual(r, { thisMonth: 2, lastMonth: 1 });
});

test("bestWeekStreak: la mejor racha de semanas con ≥ goal días", () => {
  const s = (date) => ({ date });
  const w = (mon) => [0, 1, 2, 3].map((k) => s(new Date(Date.parse(mon) + k * 864e5).toISOString().slice(0, 10)));
  const ses = [...w("2026-09-07"), ...w("2026-09-14"), ...w("2026-09-21"), s("2026-09-28"), ...w("2026-10-05")];
  assert.equal(bestWeekStreak(ses, 4), 3);
  assert.equal(bestWeekStreak([], 4), 0);
});

test("heatWeeks: n semanas lunes-domingo con el día entrenado, deload y futuro", () => {
  const ses = [
    { date: "2026-10-19", day_id: 1, is_deload: false },
    { date: "2026-10-19", day_id: 5, is_deload: false }, // el día con plan manda sobre el libre
    { date: "2026-10-14", day_id: 3, is_deload: true },
  ];
  const w = heatWeeks(ses, "2026-10-20", 2);
  assert.equal(w.length, 2);
  assert.equal(w[0].monday, "2026-10-12");
  assert.equal(w[1].monday, "2026-10-19");
  assert.deepEqual(w[1].days[0], { date: "2026-10-19", dayId: 1, deload: false, future: false, today: false });
  assert.equal(w[1].days[1].today, true);
  assert.equal(w[1].days[2].future, true);
  assert.equal(w[0].days[2].deload, true);
  assert.equal(w[0].count, 1);
  assert.equal(w[1].count, 1);
});

test("strengthByDay: series por día y ejercicio, normalizadas a reps/40 s", () => {
  const rows = [
    { date: "2026-10-01", day_id: 1, is_deload: false, work_sec: 40, exercise_id: 10, exercise_name: "Press", reps: 10 },
    { date: "2026-10-08", day_id: 1, is_deload: true, work_sec: 30, exercise_id: 10, exercise_name: "Press", reps: 9 },
    { date: "2026-10-08", day_id: 3, is_deload: false, work_sec: 40, exercise_id: 30, exercise_name: "Remo", reps: 12 },
  ];
  const g = strengthByDay(rows);
  assert.deepEqual(g.map((x) => x.dayId), [1, 3]);
  const press = g[0].exercises[0];
  assert.equal(press.name, "Press");
  assert.deepEqual(press.points.map((p) => p.y), [10, 12]);
  assert.equal(press.points[1].deload, true);
  assert.equal(press.last, 12);
  assert.equal(press.delta, 2);
});

test("inRange: filtra por 1m / 3m / all respecto a hoy", () => {
  const pts = [{ date: "2026-06-01" }, { date: "2026-08-25" }, { date: "2026-10-10" }];
  assert.equal(inRange(pts, "all", "2026-10-20").length, 3);
  assert.equal(inRange(pts, "3m", "2026-10-20").length, 2);
  assert.equal(inRange(pts, "1m", "2026-10-20").length, 1);
});

test("sparkPath: polilínea escalada al recuadro (y invertida), con margen", () => {
  assert.equal(sparkPath([0, 10], 100, 20, 2), "M2,18 L98,2");
  assert.equal(sparkPath([5, 5, 5], 100, 20, 2), "M2,10 L50,10 L98,10", "plano: centrado");
  assert.equal(sparkPath([7], 100, 20, 2), "M50,10", "un punto: centro");
  assert.equal(sparkPath([], 100, 20, 2), "");
});

import { weightSummary } from "./dash.js";

test("weightSummary: último peso, si es de hoy, tendencia 7 días, falta y puntos de la mini gráfica", () => {
  const m = [
    { date: "2026-10-10", weight_kg: 76 },
    { date: "2026-10-20", weight_kg: 75 },
    { date: "2026-10-25", weight_kg: null, waist_cm: 80 }, // sin peso: no cuenta
    { date: "2026-10-26", weight_kg: 74.6 },
  ];
  const s = weightSummary(m, "2026-10-27", 70);
  assert.deepEqual(s.last, { date: "2026-10-26", kg: 74.6 });
  assert.equal(s.today, false);
  assert.equal(s.toGoal, 4.6);
  assert.equal(typeof s.delta7, "number");
  assert.equal(s.spark.length, 3);
  assert.equal(weightSummary(m, "2026-10-26", 70).today, true);
});

test("weightSummary: en fase de volumen el objetivo está por encima", () => {
  const m = [{ date: "2026-10-26", weight_kg: 74.6 }];
  assert.equal(weightSummary(m, "2026-10-27", 78, "build").toGoal, 3.4);
  assert.equal(weightSummary(m, "2026-10-27", 70, "deficit").toGoal, 4.6);
  assert.ok(weightSummary(m, "2026-10-27", 74, "build").toGoal <= 0); // ya por encima: alcanzado
  assert.ok(weightSummary(m, "2026-10-27", 75, "deficit").toGoal <= 0);
});

test("weightSummary: sin pesos → null", () => {
  assert.equal(weightSummary([], "2026-10-27", 70), null);
  assert.equal(weightSummary([{ date: "2026-10-27", weight_kg: null }], "2026-10-27", 70), null);
});
