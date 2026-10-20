// Lógica pura del dashboard (series, deltas, objetivo, constancia, fuerza).
// Sin DOM ni Chart.js: se testea en Node. Fechas "YYYY-MM-DD", en UTC.
import { mondayISO } from "./stats.js";

const DAY = 86_400_000;
const d10 = (v) => String(v).slice(0, 10);
const toUTC = (iso) => Date.parse(d10(iso) + "T00:00:00Z");
const fromUTC = (t) => new Date(t).toISOString().slice(0, 10);
const round = (v, k = 2) => +v.toFixed(k);

/** Media de los últimos n valores (ventana creciente al principio). */
export function movingAvg(vals, n = 7) {
  return vals.map((_, i) => {
    const s = vals.slice(Math.max(0, i - n + 1), i + 1);
    return round(s.reduce((a, b) => a + b, 0) / s.length);
  });
}

/** [{date, y, ...}] → ordenados por fecha, con su media móvil en `avg`. */
export function withAvg(points, n = 7) {
  const sorted = [...points].sort((a, b) => (d10(a.date) < d10(b.date) ? -1 : 1));
  const avg = movingAvg(sorted.map((p) => p.y), n);
  return sorted.map((p, i) => ({ ...p, date: d10(p.date), avg: avg[i] }));
}

/** Media actual menos la del último punto de hace ≥ `days` días (null si no hay). */
export function deltaOver(pts, todayISO, days = 30) {
  if (!pts.length) return null;
  const limit = toUTC(todayISO) - days * DAY;
  const past = [...pts].reverse().find((p) => toUTC(p.date) <= limit);
  if (!past) return null;
  return round(pts.at(-1).avg - past.avg, 1);
}

/** Camino al objetivo desde el primer registro: kg que faltan y % recorrido. */
export function goalProgress(start, current, goal) {
  if (start == null || current == null || goal == null) return null;
  const remaining = Math.max(0, round(current - goal, 1));
  const total = start - goal;
  const pct = total <= 0 ? (current <= goal ? 100 : 0) : ((start - current) / total) * 100;
  return { remaining, pct: Math.round(Math.min(100, Math.max(0, pct))) };
}

/** Sesiones del mes de hoy y del mes anterior. */
export function monthCounts(sessions, todayISO) {
  const [y, m] = todayISO.split("-").map(Number);
  const key = (yy, mm) => `${yy}-${String(mm).padStart(2, "0")}`;
  const cur = key(y, m);
  const prev = m === 1 ? key(y - 1, 12) : key(y, m - 1);
  let thisMonth = 0;
  let lastMonth = 0;
  for (const s of sessions) {
    const k = d10(s.date).slice(0, 7);
    if (k === cur) thisMonth++;
    else if (k === prev) lastMonth++;
  }
  return { thisMonth, lastMonth };
}

const daysPerWeek = (sessions) => {
  const m = new Map();
  for (const s of sessions) {
    const w = mondayISO(d10(s.date));
    if (!m.has(w)) m.set(w, new Set());
    m.get(w).add(d10(s.date));
  }
  return m;
};

/** Mejor racha histórica de semanas seguidas con ≥ goal días entrenados. */
export function bestWeekStreak(sessions, goal = 4) {
  const m = daysPerWeek(sessions);
  const full = [...m].filter(([, set]) => set.size >= goal).map(([w]) => toUTC(w)).sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (let i = 0; i < full.length; i++) {
    run = i > 0 && full[i] - full[i - 1] === 7 * DAY ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

/** Últimas `n` semanas (lunes-domingo, la actual al final) para el calendario.
 *  Cada día: el día de plan entrenado (prioridad a 1-4 sobre el libre). */
export function heatWeeks(sessions, todayISO, n = 16) {
  const byDate = new Map();
  for (const s of sessions) {
    const k = d10(s.date);
    const cur = byDate.get(k);
    const better = !cur || (cur.day_id === 5 && s.day_id !== 5);
    if (better) byDate.set(k, { day_id: s.day_id, deload: !!s.is_deload || !!cur?.deload });
    else if (s.is_deload) cur.deload = true;
  }
  const today = toUTC(todayISO);
  const thisMon = toUTC(mondayISO(todayISO));
  const weeks = [];
  for (let w = n - 1; w >= 0; w--) {
    const mon = thisMon - w * 7 * DAY;
    const days = [];
    let count = 0;
    for (let k = 0; k < 7; k++) {
      const t = mon + k * DAY;
      const date = fromUTC(t);
      const hit = byDate.get(date);
      if (hit) count++;
      days.push({ date, dayId: hit ? hit.day_id : null, deload: !!hit?.deload, future: t > today, today: t === today });
    }
    weeks.push({ monday: fromUTC(mon), days, count });
  }
  return weeks;
}

/** Filas de fuerza → [{dayId, exercises:[{id, name, points:[{date,y,deload}], last, delta}]}],
 *  con reps normalizadas a 40 s de trabajo. */
export function strengthByDay(rows) {
  const days = new Map();
  for (const r of rows) {
    if (!days.has(r.day_id)) days.set(r.day_id, new Map());
    const exs = days.get(r.day_id);
    if (!exs.has(r.exercise_id)) exs.set(r.exercise_id, { id: r.exercise_id, name: r.exercise_name, points: [] });
    exs.get(r.exercise_id).points.push({
      date: d10(r.date),
      y: round((r.reps * 40) / (r.work_sec || 40), 1),
      deload: !!r.is_deload,
    });
  }
  return [...days]
    .sort(([a], [b]) => a - b)
    .map(([dayId, exs]) => ({
      dayId,
      exercises: [...exs.values()].sort((a, b) => a.id - b.id).map((e) => { // orden del plan
        const points = e.points.sort((a, b) => (a.date < b.date ? -1 : 1));
        return { ...e, points, last: points.at(-1).y, delta: round(points.at(-1).y - points[0].y, 1) };
      }),
    }));
}

/** Puntos dentro del rango: "1m" (30 d), "3m" (91 d) o "all". */
export function inRange(points, range, todayISO) {
  if (range === "all") return points;
  const days = range === "1m" ? 30 : 91;
  const limit = toUTC(todayISO) - days * DAY;
  return points.filter((p) => toUTC(p.date) >= limit);
}

/** Path SVG de una sparkline en un recuadro w×h con margen `pad` (y hacia arriba). */
export function sparkPath(vals, w, h, pad = 2) {
  if (!vals.length) return "";
  const r = (v) => Math.round(v * 10) / 10;
  if (vals.length === 1) return `M${r(w / 2)},${r(h / 2)}`;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const x = (i) => r(pad + (i * (w - 2 * pad)) / (vals.length - 1));
  const y = (v) => (max === min ? r(h / 2) : r(h - pad - ((v - min) * (h - 2 * pad)) / (max - min)));
  return vals.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
}
