// Discos, pesos posibles y doble progresión. Lógica pura (sin DOM): se testea en Node.
//
// Material de Ferran: barras de plástico (≈0 kg) y una barra que une las dos
// mancuernas. Los discos van siempre iguales a cada lado.
//   pair       = las dos mancuernas cargadas igual (el peso es POR mancuerna)
//   single     = una sola mancuerna con todos los discos
//   bar        = la barra (dos mancuernas unidas): todos los discos en una carga
//   bodyweight = sin peso
export const PLATES = [
  { kg: 2.5, n: 4 },
  { kg: 2, n: 4 },
  { kg: 1.5, n: 4 },
  { kg: 1.25, n: 5 },
];

const r2 = (v) => Math.round(v * 100) / 100;
// Cuántos "lados" se cargan a la vez: par = 2 mancuernas × 2 lados; una carga = 2 lados.
const sidesFor = (eq) => (eq === "pair" ? 4 : eq === "single" || eq === "bar" ? 2 : 0);

/** Todas las combinaciones por lado: [{total, perSide:[{kg,count}], pieces}]. */
const combos = (() => {
  const cache = {};
  return (eq) => {
    if (cache[eq]) return cache[eq];
    const sides = sidesFor(eq);
    if (!sides) return (cache[eq] = []);
    const max = PLATES.map((p) => Math.floor(p.n / sides));
    const out = [];
    const walk = (i, counts) => {
      if (i === PLATES.length) {
        const side = counts.reduce((a, c, k) => a + c * PLATES[k].kg, 0);
        out.push({
          total: r2(side * 2),
          perSide: counts.map((c, k) => ({ kg: PLATES[k].kg, count: c })).filter((x) => x.count),
          pieces: counts.reduce((a, b) => a + b, 0),
        });
        return;
      }
      for (let c = 0; c <= max[i]; c++) walk(i + 1, [...counts, c]);
    };
    walk(0, []);
    return (cache[eq] = out);
  };
})();

/** Pesos montables (kg por mancuerna en "pair", por carga en "single"/"bar"), ordenados. */
export function loadOptions(eq) {
  return [...new Set(combos(eq).map((c) => c.total))].sort((a, b) => a - b);
}

/** Discos por lado para un peso, con el mínimo de piezas (null si no se puede montar). */
export function platesFor(kg, eq) {
  const best = combos(eq)
    .filter((c) => c.total === r2(kg))
    .sort((a, b) => a.pieces - b.pieces)[0];
  return best ? best.perSide : null;
}

const es = (v) => String(v).replace(".", ",");

/** "por lado: 2,5 + 1,5" · "sin discos" · "" si no se puede montar. */
export function platesText(kg, eq) {
  const p = platesFor(kg, eq);
  if (p == null) return "";
  if (!p.length) return "sin discos";
  return "por lado: " + p.map((x) => (x.count > 1 ? `${x.count} × ${es(x.kg)}` : es(x.kg))).join(" + ");
}

/** Siguiente (dir=1) o anterior (dir=-1) peso montable; topa en los extremos. */
export function stepLoad(kg, eq, dir) {
  const o = loadOptions(eq);
  if (!o.length) return null;
  if (kg == null) return dir > 0 ? o.find((v) => v > 0) ?? o[0] : o[0];
  if (dir > 0) return o.find((v) => v > r2(kg)) ?? o.at(-1);
  return [...o].reverse().find((v) => v < r2(kg)) ?? o[0];
}

/** Reps por encima del máximo del rango que justifican subir tras una sola sesión. */
export const JUMP_MARGIN = 4;

const allAtLeast = (reps, n) => reps.length > 0 && reps.every((r) => r >= n);
const anyBelow = (reps, n) => reps.some((r) => r < n);

/** Doble progresión. `history`: sesiones de MÁS RECIENTE a más antigua,
 *  cada una {kg, reps:[por ronda], deload}. El deload no cuenta.
 *  Sube tras 2 sesiones seguidas al máximo, o tras 1 si va JUMP_MARGIN por encima.
 *  → {action: start|hold|up|down, kg, from?} */
export function progression(history, ex) {
  const eq = ex.equipment;
  if (eq === "bodyweight" || !eq) return { action: "hold", kg: null }; // sin kilos
  const real = history.filter((h) => !h.deload);
  if (!real.length) return { action: "start", kg: history[0]?.kg ?? null }; // solo deload: referencia
  const last = real[0];
  const kg = last.kg ?? null;
  if (kg == null) return { action: "start", kg: null };
  if (ex.rep_min == null || ex.rep_max == null) return { action: "hold", kg };
  // Muy sobrado (máximo + JUMP_MARGIN en todas las rondas): subir ya, sin esperar otra sesión.
  if (last.reps.length >= 2 && allAtLeast(last.reps, ex.rep_max + JUMP_MARGIN)) {
    const up = stepLoad(kg, eq, 1);
    if (up > kg) return { action: "up", kg: up, from: kg };
  }
  if (real.length < 2) return { action: "hold", kg };
  const [a, b] = real;
  const sameKg = r2(a.kg ?? -1) === r2(b.kg ?? -2);
  if (sameKg && allAtLeast(a.reps, ex.rep_max) && allAtLeast(b.reps, ex.rep_max)) {
    const up = stepLoad(kg, eq, 1);
    if (up > kg) return { action: "up", kg: up, from: kg };
  }
  if (sameKg && anyBelow(a.reps, ex.rep_min) && anyBelow(b.reps, ex.rep_min)) {
    const down = stepLoad(kg, eq, -1);
    if (down < kg) return { action: "down", kg: down, from: kg };
  }
  return { action: "hold", kg };
}

// Peso de partida cuando un ejercicio aún no tiene historial con kg: un punto
// prudente para llegar al rango de reps (luego la progresión lo ajusta sola).
// Por id del plan; si no, por material. Siempre montable con los discos.
const STARTER = { 30: 10, 31: 12, 32: 8, 33: 5, 34: 6 };
const STARTER_EQ = { pair: 5, single: 8, bar: 8 };

/** kg sugerido de partida (null en peso corporal). */
export function starterKg(ex) {
  const eq = ex.equipment;
  if (!eq || eq === "bodyweight") return null;
  const want = STARTER[ex.id] ?? STARTER_EQ[eq];
  const o = loadOptions(eq);
  return o.reduce((best, v) => (Math.abs(v - want) < Math.abs(best - want) ? v : best), o[0]);
}

/** "Hoy toca" de cada ejercicio a partir de /api/last_logs ({exId: [sesiones, más reciente primero]}).
 *  → {exId: {equipment, rep_min, rep_max, action, kg, from, plates, last:{date,kg,reps}|null}} */
export function targetsFor(exercises, lastLogs) {
  const out = {};
  for (const ex of exercises) {
    const hist = (lastLogs?.[ex.id] || lastLogs?.[String(ex.id)] || []).map((h) => ({
      kg: h.kg,
      reps: h.rounds.map((r) => r.reps).filter((n) => n != null),
      deload: h.deload,
      date: h.date,
    }));
    let p = progression(hist, ex);
    if (p.action === "start" && p.kg == null && starterKg(ex) != null) p = { ...p, kg: starterKg(ex), suggested: true };
    const l = hist[0];
    out[ex.id] = {
      equipment: ex.equipment,
      rep_min: ex.rep_min,
      rep_max: ex.rep_max,
      ...p,
      plates: p.kg != null ? platesText(p.kg, ex.equipment) : "",
      last: l ? { date: l.date, kg: l.kg, reps: l.reps } : null,
    };
  }
  return out;
}

/** Récords de la sesión frente a /api/records (antes de guardarla).
 *  kg: peso por encima del máximo de siempre. reps: más reps que nunca con ese
 *  peso. La primera vez que se apunta un ejercicio no cuenta; igualar tampoco.
 *  Uno por ejercicio (el de kg manda). */
export function detectPRs(records, logs) {
  const byEx = new Map();
  for (const l of logs) {
    if (!byEx.has(l.exercise_id)) byEx.set(l.exercise_id, []);
    byEx.get(l.exercise_id).push(l);
  }
  // Misma clave que Python str(float): 5 → "5.0", 5.5 → "5.5", 4.75 → "4.75".
  const key = (kg) => (kg == null ? "0" : Number.isInteger(Number(kg)) ? Number(kg).toFixed(1) : String(Number(kg)));
  const out = [];
  for (const [exId, rows] of byEx) {
    const rec = records?.[exId] || records?.[String(exId)];
    if (!rec) continue;
    const kgs = rows.map((r) => r.weight_kg).filter((k) => k != null);
    const maxKg = kgs.length ? Math.max(...kgs) : null;
    if (maxKg != null && rec.max_kg != null && maxKg > rec.max_kg) {
      out.push({ exerciseId: exId, type: "kg", kg: maxKg, prev: rec.max_kg });
      continue;
    }
    let best = null;
    for (const r of rows) {
      if (r.reps == null) continue;
      const prev = rec.reps_by_kg?.[key(r.weight_kg)];
      if (prev == null || r.reps <= prev) continue;
      if (!best || r.reps > best.reps) best = { exerciseId: exId, type: "reps", kg: r.weight_kg ?? null, reps: r.reps, prev };
    }
    if (best) out.push(best);
  }
  return out;
}
