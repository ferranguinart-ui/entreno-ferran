import test from "node:test";
import assert from "node:assert/strict";
import { mondayISO, weekProgress, nextDayId } from "./stats.js";

const s = (date, day_id = 1) => ({ date, day_id });

test("mondayISO: lunes de la semana (semana lunes-domingo)", () => {
  assert.equal(mondayISO("2026-10-19"), "2026-10-19"); // lunes
  assert.equal(mondayISO("2026-10-25"), "2026-10-19"); // domingo
  assert.equal(mondayISO("2026-10-18"), "2026-10-12");
  assert.equal(mondayISO("2026-11-01"), "2026-10-26"); // cruza mes (y cambio de hora)
});

test("weekProgress: días con sesión esta semana (varias sesiones el mismo día cuentan 1)", () => {
  const p = weekProgress([s("2026-10-20"), s("2026-10-20", 2), s("2026-10-21")], "2026-10-22");
  assert.equal(p.done, 2);
  assert.equal(p.goal, 4);
});

test("weekProgress: racha de semanas completas seguidas", () => {
  const ses = [
    // semana 12-18 oct: 4 días
    ...["2026-10-12", "2026-10-13", "2026-10-15", "2026-10-17"].map((d) => s(d)),
    // semana 5-11 oct: 4 días
    ...["2026-10-05", "2026-10-06", "2026-10-08", "2026-10-10"].map((d) => s(d)),
    // semana 28 sep-4 oct: 3 días (corta la racha)
    ...["2026-09-28", "2026-09-30", "2026-10-02"].map((d) => s(d)),
    // semana anterior completa: no cuenta, la racha ya se cortó
    ...["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"].map((d) => s(d)),
  ];
  assert.equal(weekProgress(ses, "2026-10-20").streak, 2, "la semana en curso aún no cuenta");
});

test("weekProgress: la semana en curso suma a la racha en cuanto se completa", () => {
  const ses = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-16"].map((d) => s(d));
  const p = weekProgress(ses, "2026-10-22");
  assert.equal(p.done, 4);
  assert.equal(p.streak, 2);
});

test("weekProgress: sin sesiones", () => {
  assert.deepEqual(weekProgress([], "2026-10-20"), { done: 0, goal: 4, streak: 0 });
});

test("nextDayId: rota 1→2→3→4→1 según el último entreno con plan", () => {
  assert.equal(nextDayId([], [1, 2, 3, 4]), 1);
  assert.equal(nextDayId([s("2026-10-20", 2)], [1, 2, 3, 4]), 3);
  assert.equal(nextDayId([s("2026-10-20", 4)], [1, 2, 3, 4]), 1);
  // el día libre (5) no cuenta: se mira la última sesión de un día con plan
  assert.equal(nextDayId([s("2026-10-21", 5), s("2026-10-20", 1)], [1, 2, 3, 4]), 2);
});

import { stepValue, holdInterval, groupByWeek } from "./stats.js";

test("stepValue: suma y acota (0..999), vacío cuenta como 0", () => {
  assert.equal(stepValue(10, 1), 11);
  assert.equal(stepValue(0, -1), 0);
  assert.equal(stepValue("", 1), 1);
  assert.equal(stepValue(999, 5), 999);
  assert.equal(stepValue("7", -2), 5);
});

test("holdInterval: al mantener pulsado acelera hasta un mínimo", () => {
  assert.equal(holdInterval(0), 400);
  assert.ok(holdInterval(3) < holdInterval(1));
  assert.equal(holdInterval(50), 60);
});

test("groupByWeek: semanas de más reciente a más antigua, días con sesión por semana", () => {
  const s = (date, day_id = 1) => ({ date, day_id });
  const g = groupByWeek([s("2026-10-20"), s("2026-10-19", 2), s("2026-10-19", 5), s("2026-10-14")]);
  assert.deepEqual(g.map((w) => w.monday), ["2026-10-19", "2026-10-12"]);
  assert.equal(g[0].items.length, 3);
  assert.equal(g[0].days, 2, "dos días distintos");
  assert.equal(g[1].days, 1);
});
