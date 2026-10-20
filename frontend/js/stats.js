// Estadísticas puras para el inicio (racha, entreno de hoy). Sin DOM.
// Fechas como "YYYY-MM-DD"; se calcula en UTC para no sufrir el cambio de hora.

const DAY = 86_400_000;
const toUTC = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUTC = (t) => new Date(t).toISOString().slice(0, 10);

/** Lunes de la semana de `iso` (semanas lunes-domingo, como el dashboard). */
export function mondayISO(iso) {
  const t = toUTC(iso);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // 0 = lunes
  return fromUTC(t - dow * DAY);
}

/** Días con sesión en la semana actual y racha de semanas seguidas con ≥ goal.
 *  La semana en curso suma a la racha solo cuando ya está completa. */
export function weekProgress(sessions, todayISO, goal = 4) {
  const daysByWeek = new Map();
  for (const s of sessions) {
    const w = mondayISO(String(s.date).slice(0, 10));
    if (!daysByWeek.has(w)) daysByWeek.set(w, new Set());
    daysByWeek.get(w).add(String(s.date).slice(0, 10));
  }
  const count = (w) => daysByWeek.get(w)?.size || 0;
  const thisWeek = mondayISO(todayISO);
  const done = count(thisWeek);
  let streak = done >= goal ? 1 : 0;
  for (let w = toUTC(thisWeek) - 7 * DAY; count(fromUTC(w)) >= goal; w -= 7 * DAY) streak++;
  return { done, goal, streak };
}

/** Siguiente día del plan tras el último entrenado (rotación; ignora días sin plan). */
export function nextDayId(sessions, planIds) {
  const last = sessions.find((s) => planIds.includes(s.day_id)); // vienen de más reciente a más antigua
  if (!last) return planIds[0];
  return planIds[(planIds.indexOf(last.day_id) + 1) % planIds.length];
}
