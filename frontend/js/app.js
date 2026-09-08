import { api } from "./api.js";
import { buildSteps, TimerEngine } from "./timer.js";

const app = document.getElementById("app");
const state = { boot: null, run: null, engine: null };

const todayISO = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD local
const h = (html) => {
  app.classList.remove("loading");
  app.innerHTML = html;
};
const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (sec) => {
  sec = Math.max(0, sec | 0);
  return `${String((sec / 60) | 0).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
};

function toast(msg) {
  let t = document.getElementById("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2600);
}

const dayById = (id) => state.boot.days.find((d) => d.id === +id);
const warmupExercises = () => (dayById(0)?.exercises || []).filter((e) => e.block === "warmup");
const mainExercises = (day) => day.exercises.filter((e) => e.block === "main");
const remateExercises = (day) => day.exercises.filter((e) => e.block === "remate");

// ------------------------------- router --------------------------------
const routes = [
  [/^#\/login$/, viewLogin],
  [/^#\/$/, viewHome],
  [/^#\/setup\/(\d+)$/, viewSetup],
  [/^#\/run$/, viewRun],
  [/^#\/log$/, viewLog],
  [/^#\/manual$/, viewManual],
  [/^#\/measure$/, viewMeasure],
  [/^#\/history$/, viewHistory],
  [/^#\/dashboard$/, viewDashboard],
];

async function router() {
  const hash = location.hash || "#/";
  if (hash !== "#/login") {
    if (!state.boot) {
      const me = await api.me().catch(() => ({ authenticated: false }));
      if (!me.authenticated) {
        location.hash = "#/login";
        return;
      }
      state.boot = await api.bootstrap();
      api.flushPending();
    }
  }
  if (state.engine && hash !== "#/run") {
    state.engine.stop();
    state.engine = null;
  }
  if (state.charts && hash !== "#/dashboard") {
    state.charts.forEach((c) => c.destroy());
    state.charts = null;
  }
  for (const [re, view] of routes) {
    const m = hash.match(re);
    if (m) return view(...m.slice(1));
  }
  location.hash = "#/";
}
window.addEventListener("hashchange", router);

// ------------------------------- login ---------------------------------
function viewLogin() {
  h(`
    <div class="pane center">
      <h1 class="brand">Entreno</h1>
      <form id="f" class="card col">
        <label>PIN</label>
        <input id="pin" type="password" inputmode="numeric" autocomplete="off" autofocus />
        <button class="primary">Entrar</button>
        <p id="err" class="err"></p>
      </form>
    </div>`);
  document.getElementById("f").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api.login(document.getElementById("pin").value);
      state.boot = null;
      location.hash = "#/";
      router();
    } catch (_) {
      document.getElementById("err").textContent = "PIN incorrecto";
    }
  });
}

// ------------------------------- home ----------------------------------
function viewHome() {
  const pend = api.pendingCount();
  const cards = state.boot.days
    .filter((d) => d.id >= 1)
    .map((d) => {
      const target = d.id === 5 ? "#/manual" : `#/setup/${d.id}`;
      const mus = mainExercises(d).map((e) => e.name).slice(0, 4).join(" · ");
      return `<a class="card day" href="${target}">
        <div class="row between"><strong>Día ${d.id} — ${esc(d.name)}</strong>
          <span class="pill">${d.rounds} rondas · ${d.work_sec}s</span></div>
        <div class="muted small">${esc(mus || d.focus || "Registro manual")}</div>
      </a>`;
    })
    .join("");
  h(`
    <div class="pane">
      <header class="row between">
        <h1 class="brand">Entreno</h1>
        <button class="ghost" id="out">Salir</button>
      </header>
      ${pend ? `<div class="note warn">${pend} guardado(s) sin subir — se enviarán al reconectar</div>` : ""}
      <div class="day-list">${cards}</div>
      <div class="nav-grid mt">
        <a class="btn" href="#/dashboard">Dashboard</a>
        <a class="btn" href="#/manual">Registrar sesión manual</a>
        <a class="btn" href="#/measure">Medidas corporales</a>
        <a class="btn" href="#/history">Historial</a>
      </div>
    </div>`);
  document.getElementById("out").onclick = async () => {
    await api.logout();
    state.boot = null;
    location.hash = "#/login";
    router();
  };
}

// ------------------------------- setup ---------------------------------
function viewSetup(dayId) {
  const day = dayById(dayId);
  if (!day) return (location.hash = "#/");
  let rounds = day.rounds;
  let deload = false;

  const draw = () => {
    const shown = deload ? day.rounds_deload : rounds;
    h(`
      <div class="pane">
        <header class="row between"><a class="ghost" href="#/">‹ Atrás</a>
          <h2>Día ${day.id} — ${esc(day.name)}</h2><span></span></header>
        <div class="card col gap">
          <div class="muted small">${esc(day.focus || "")} · ${day.work_sec}s / ${day.rest_ex_sec}s / ${day.rest_round_sec}s</div>
          <label>Rondas</label>
          <div class="stepper">
            <button id="minus" ${deload ? "disabled" : ""}>−</button>
            <span class="big">${shown}</span>
            <button id="plus" ${deload ? "disabled" : ""}>+</button>
          </div>
          <label class="row gap"><input type="checkbox" id="deload" ${deload ? "checked" : ""}/> Semana de deload (${day.rounds_deload} rondas)</label>
        </div>
        <button class="primary big-btn" id="go">Empezar entreno</button>
      </div>`);
    document.getElementById("minus").onclick = () => { rounds = Math.max(day.rounds_min, rounds - 1); draw(); };
    document.getElementById("plus").onclick = () => { rounds = Math.min(day.rounds_max, rounds + 1); draw(); };
    document.getElementById("deload").onchange = (e) => { deload = e.target.checked; draw(); };
    document.getElementById("go").onclick = () => {
      state.run = {
        day,
        rounds: deload ? day.rounds_deload : rounds,
        isDeload: deload,
        date: todayISO(),
        source: "timer",
      };
      location.hash = "#/run";
    };
  };
  draw();
}

// ------------------------------- run -----------------------------------
function viewRun() {
  const r = state.run;
  if (!r) return (location.hash = "#/");
  const { day } = r;
  let totalDuration = 0;

  const steps = buildSteps(day, warmupExercises(), { rounds: r.rounds, remates: [] });

  h(`
    <div class="pane run" id="runpane">
      <div class="run-top">
        <span id="phase" class="phase">Preparado</span>
        <span id="round" class="round"></span>
      </div>
      <div id="digits" class="digits">${fmt(steps[0].seconds)}</div>
      <div id="exname" class="exname">${esc(steps[0].name)}</div>
      <div id="exmus" class="muted"></div>
      <div id="next" class="next">Siguiente: ${esc(steps[0].nextName)}</div>
      <div class="bar"><div id="fill" class="fill"></div></div>
      <div class="run-controls">
        <button id="back">&#9198;</button>
        <button id="pp" class="primary">Pausa</button>
        <button id="skip">&#9197;</button>
      </div>
      <button class="ghost small" id="exit">Salir sin guardar</button>
      <div id="overlay" class="overlay"><button class="primary big-btn" id="begin">Toca para empezar</button></div>
    </div>`);

  const $ = (id) => document.getElementById(id);
  const paint = (step, i) => {
    $("runpane").dataset.kind = step.kind;
    $("phase").textContent = step.phase;
    $("round").textContent =
      step.round > 0 && step.kind !== "warmup" && step.phase !== "Remate"
        ? `Ronda ${step.round}/${step.totalRounds}`
        : step.phase === "Remate"
        ? "Remate"
        : "";
    $("exname").textContent = step.name;
    $("exmus").textContent = step.muscle || step.note || "";
    $("next").textContent = "Siguiente: " + step.nextName;
    $("digits").textContent = fmt(step.seconds);
    $("fill").style.width = `${((i + 1) / steps.length) * 100}%`;
  };

  const makeEngine = (stp, onDone) =>
    new TimerEngine(stp, {
      onTick: (s) => { $("digits").textContent = fmt(s); },
      onStep: paint,
      onDone,
    });

  const finish = (doneRemates) => {
    r.doneRemates = doneRemates;
    r.durationSec = totalDuration;
    r.roundsCompleted = r.rounds;
    state.engine = null;
    location.hash = "#/log";
  };

  const afterMain = () => {
    totalDuration += state.engine.durationSec();
    const rem = remateExercises(day);
    if (!rem.length) return finish([]);
    const ov = $("overlay");
    ov.classList.add("show");
    ov.innerHTML = `
      <div class="card col gap">
        <strong>¿Hacer remate?</strong>
        ${rem
          .map(
            (e) =>
              `<label class="row gap"><input type="checkbox" value="${e.id}" ${
                e.is_optional ? "" : "checked"
              }/> ${esc(e.name)} · ${e.work_sec ?? day.work_sec}s</label>`
          )
          .join("")}
        <button class="primary" id="remgo">Continuar</button>
      </div>`;
    $("remgo").onclick = () => {
      const chosen = [...ov.querySelectorAll("input:checked")].map((c) => +c.value);
      const exs = rem.filter((e) => chosen.includes(e.id));
      if (!exs.length) return finish([]);
      const rSteps = buildSteps(day, [], { rounds: 0, remates: exs });
      state.engine = makeEngine(rSteps, () => {
        totalDuration += state.engine.durationSec();
        finish(exs);
      });
      ov.innerHTML = `<button class="primary big-btn" id="begin2">Toca para seguir</button>`;
      $("begin2").onclick = () => {
        ov.classList.remove("show");
        state.engine.start();
      };
    };
  };

  state.engine = makeEngine(steps, afterMain);
  $("begin").onclick = () => {
    $("overlay").classList.remove("show");
    state.engine.start();
  };
  $("pp").onclick = () => {
    const e = state.engine;
    if (e.running) { e.pause(); $("pp").textContent = "Reanudar"; }
    else { e.resume(); $("pp").textContent = "Pausa"; }
  };
  $("skip").onclick = () => state.engine.skip();
  $("back").onclick = () => state.engine.back();
  $("exit").onclick = () => {
    if (confirm("¿Salir sin guardar el entreno?")) {
      state.engine.stop();
      state.engine = null;
      state.run = null;
      location.hash = "#/";
    }
  };
}

// ------------------------------- log -----------------------------------
async function viewLog() {
  const r = state.run;
  if (!r) return (location.hash = "#/");
  const { day } = r;
  const list = [...mainExercises(day), ...(r.doneRemates || [])];
  let prefill = {};
  try { prefill = await api.prefill(day.id); } catch (_) {}

  h(`
    <div class="pane">
      <header class="row between"><span></span><h2>Registrar — Día ${day.id}</h2><span></span></header>
      <div class="muted small">${r.date} · ${r.rounds} rondas${r.isDeload ? " · deload" : ""}${
    r.durationSec ? " · " + fmt(r.durationSec) : ""
  } · reps de la ronda 1</div>
      <div class="col gap mt">
        ${
          list.length
            ? list
                .map(
                  (e) => `<div class="card row between">
            <div><strong>${esc(e.name)}</strong><div class="muted small">${esc(e.muscle_primary || "")}</div></div>
            <input class="reps" data-ex="${e.id}" type="number" inputmode="numeric" min="0"
                   value="${prefill[e.id] ?? ""}" placeholder="reps" />
          </div>`
                )
                .join("")
            : `<div class="muted">Sin ejercicios en este día.</div>`
        }
      </div>
      <button class="primary big-btn mt" id="save">Guardar sesión</button>
      <button class="ghost small" id="skip">Guardar sin apuntar reps</button>
    </div>`);

  const save = async (withReps) => {
    const logs = withReps
      ? [...document.querySelectorAll(".reps")]
          .filter((i) => i.value !== "")
          .map((i) => ({ exercise_id: +i.dataset.ex, reps: +i.value, round_number: 1 }))
      : [];
    const res = await api.saveWorkout({
      session: {
        day_id: day.id,
        date: r.date,
        rounds_planned: r.rounds,
        is_deload: r.isDeload,
        source: r.source,
        work_sec: day.work_sec,
      },
      patch: { rounds_completed: r.roundsCompleted ?? r.rounds, duration_sec: r.durationSec ?? null },
      logs,
    });
    state.run = null;
    toast(res.queued ? "Guardado local — se subirá al reconectar" : "Sesión guardada");
    location.hash = "#/";
  };
  document.getElementById("save").onclick = () => save(true);
  document.getElementById("skip").onclick = () => save(false);
}

// ------------------------------- manual --------------------------------
function viewManual() {
  const opts = state.boot.days
    .filter((d) => d.id >= 1)
    .map((d) => `<option value="${d.id}">Día ${d.id} — ${esc(d.name)}</option>`)
    .join("");
  h(`
    <div class="pane">
      <header class="row between"><a class="ghost" href="#/">‹ Atrás</a><h2>Sesión manual</h2><span></span></header>
      <div class="card col gap">
        <label>Día</label><select id="day">${opts}</select>
        <label>Fecha</label><input id="date" type="date" value="${todayISO()}" />
        <label>Rondas</label><input id="rounds" type="number" min="1" max="6" value="3" />
        <label class="row gap"><input type="checkbox" id="deload" /> Deload</label>
      </div>
      <button class="primary big-btn" id="go">Continuar a registro</button>
    </div>`);
  document.getElementById("go").onclick = () => {
    const day = dayById(document.getElementById("day").value);
    const n = +document.getElementById("rounds").value;
    state.run = {
      day,
      rounds: n,
      isDeload: document.getElementById("deload").checked,
      date: document.getElementById("date").value,
      source: "manual",
      roundsCompleted: n,
      durationSec: null,
      doneRemates: [],
    };
    location.hash = "#/log";
  };
}

// ------------------------------- measure -------------------------------
async function viewMeasure() {
  const reminder = state.boot.settings?.weighin_reminder || "";
  let rows = [];
  try { rows = await api.measurements(); } catch (_) {}
  const recent = rows
    .slice(-8)
    .reverse()
    .map(
      (m) =>
        `<tr><td>${m.date}</td><td>${m.weight_kg ?? "—"}</td><td>${m.waist_cm ?? "—"}</td><td>${
          m.is_standard_conditions ? "" : "⚠"
        }</td></tr>`
    )
    .join("");
  h(`
    <div class="pane">
      <header class="row between"><a class="ghost" href="#/">‹ Atrás</a><h2>Medidas</h2><span></span></header>
      <div class="card col gap">
        <label>Fecha</label><input id="date" type="date" value="${todayISO()}" />
        <label>Peso (kg)</label><input id="w" type="number" inputmode="decimal" step="0.1" />
        <label>Cintura (cm)</label><input id="waist" type="number" inputmode="decimal" step="0.1" />
        <label class="row gap"><input type="checkbox" id="std" checked /> Condiciones estándar</label>
        <div class="muted small">${esc(reminder)}</div>
        <label>Nota</label><input id="note" type="text" placeholder="opcional" />
      </div>
      <button class="primary big-btn" id="go">Guardar</button>
      <table class="mt"><thead><tr><th>Fecha</th><th>Peso</th><th>Cintura</th><th></th></tr></thead>
        <tbody>${recent || `<tr><td colspan="4" class="muted">Sin registros</td></tr>`}</tbody></table>
    </div>`);
  document.getElementById("go").onclick = async () => {
    const w = document.getElementById("w").value;
    const waist = document.getElementById("waist").value;
    if (w === "" && waist === "") return toast("Introduce peso o cintura");
    const res = await api.saveMeasurement({
      date: document.getElementById("date").value,
      weight_kg: w === "" ? null : +w,
      waist_cm: waist === "" ? null : +waist,
      is_standard_conditions: document.getElementById("std").checked,
      note: document.getElementById("note").value || null,
    });
    toast(res.queued ? "Guardado local — se subirá al reconectar" : "Medida guardada");
    viewMeasure();
  };
}

// ------------------------------- history -------------------------------
async function viewHistory() {
  let s = [];
  try { s = await api.sessions(50); } catch (_) {}
  h(`
    <div class="pane">
      <header class="row between"><a class="ghost" href="#/">‹ Atrás</a><h2>Historial</h2><span></span></header>
      <div class="col gap mt">
        ${
          s.length
            ? s
                .map(
                  (x) => `<div class="card row between">
          <div><strong>${x.date}</strong> · Día ${x.day_id} ${esc(x.day_name)}</div>
          <div class="muted small">${x.rounds_completed ?? "?"} rd${x.is_deload ? " · deload" : ""}${
                    x.duration_sec ? " · " + fmt(x.duration_sec) : ""
                  } · ${x.source}</div>
        </div>`
                )
                .join("")
            : `<div class="muted">Sin sesiones todavía</div>`
        }
      </div>
    </div>`);
}

// ------------------------------- dashboard ----------------------------
async function viewDashboard() {
  let d;
  try {
    d = await api.dashboard();
  } catch (_) {
    return;
  }
  const hasChart = typeof window.Chart === "function";
  h(`
    <div class="pane dash">
      <header class="row between"><a class="ghost" href="#/">‹ Atrás</a><h2>Dashboard</h2><span></span></header>
      ${hasChart ? "" : `<div class="note warn">Sin conexión para cargar los gráficos. Reintenta con red.</div>`}
      <section class="card sec-weight">
        <h3>Peso <span class="muted small">objetivo ${d.goal_weight_kg} kg</span></h3>
        <div class="cw"><canvas id="cWeight"></canvas></div>
        <div class="muted small">Línea gruesa = media móvil de 7 registros. ▲ = fuera de condiciones estándar.</div>
      </section>
      <section class="card sec-waist">
        <h3>Cintura</h3>
        <div class="cw"><canvas id="cWaist"></canvas></div>
        <div class="muted small">Línea gruesa = media móvil de 7 registros.</div>
      </section>
      <section class="card sec-consistency">
        <h3>Consistencia <span class="muted small">objetivo 4/semana</span></h3>
        <div id="heat" class="heat"></div>
        <div class="muted small">Cada fila una semana. Verde = sesión · Morado = deload.</div>
      </section>
      <section class="card sec-strength">
        <h3>Progresión de fuerza <span class="muted small">reps / 40 s</span></h3>
        <div id="strength" class="subs"></div>
        <div class="muted small">▲ = sesión de deload.</div>
      </section>
    </div>`);

  state.charts = [];
  const iso = (dt) => dt.toLocaleDateString("sv-SE");
  const movingAvg = (vals, n = 7) =>
    vals.map((_, i) => {
      const s = vals.slice(Math.max(0, i - n + 1), i + 1);
      return +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2);
    });
  const lineOpts = () => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: { legend: { labels: { color: "#9aa3b2", boxWidth: 12, font: { size: 11 } } } },
    scales: {
      x: { ticks: { color: "#9aa3b2", maxRotation: 0, autoSkip: true, maxTicksLimit: 6 }, grid: { color: "#ffffff12" } },
      y: { ticks: { color: "#9aa3b2" }, grid: { color: "#ffffff12" } },
    },
  });

  const mkMeasureChart = (canvasId, key, withGoal) => {
    const pts = d.measurements
      .filter((m) => m[key] != null)
      .map((m) => ({ date: m.date, y: +m[key], std: m.is_standard_conditions }));
    if (!hasChart) return;
    if (!pts.length) {
      const n = document.createElement("div");
      n.className = "muted small";
      n.textContent = "Sin datos todavía.";
      document.getElementById(canvasId).closest(".cw").replaceWith(n);
      return;
    }
    const labels = pts.map((p) => p.date);
    const raw = pts.map((p) => p.y);
    const ds = [
      {
        label: "registro",
        data: raw,
        borderColor: "#4f8cff55",
        backgroundColor: "#4f8cff",
        pointRadius: pts.map((p) => (p.std ? 3 : 6)),
        pointStyle: pts.map((p) => (p.std ? "circle" : "triangle")),
        borderWidth: 1,
        tension: 0.2,
      },
      { label: "media 7", data: movingAvg(raw), borderColor: "#4f8cff", pointRadius: 0, borderWidth: 3, tension: 0.3 },
    ];
    if (withGoal)
      ds.push({
        label: "objetivo",
        data: labels.map(() => d.goal_weight_kg),
        borderColor: "#3fae6b",
        borderDash: [6, 6],
        pointRadius: 0,
        borderWidth: 1.5,
      });
    state.charts.push(
      new Chart(document.getElementById(canvasId), { type: "line", data: { labels, datasets: ds }, options: lineOpts() })
    );
  };
  mkMeasureChart("cWeight", "weight_kg", true);
  mkMeasureChart("cWaist", "waist_cm", false);

  // consistency heatmap
  const byDay = {};
  d.sessions.forEach((s) => ((byDay[s.date] ||= []).push(s)));
  const monday = (dt) => {
    const x = new Date(dt);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const thisMon = monday(new Date());
  let heatHTML = "";
  for (let w = 11; w >= 0; w--) {
    const start = new Date(thisMon);
    start.setDate(start.getDate() - w * 7);
    let cells = "";
    let count = 0;
    let deload = false;
    for (let k = 0; k < 7; k++) {
      const c = new Date(start);
      c.setDate(c.getDate() + k);
      const ss = byDay[iso(c)];
      let cls = "hc";
      if (ss) {
        count++;
        if (ss.some((x) => x.is_deload)) {
          cls += " dl";
          deload = true;
        } else cls += " on";
      }
      cells += `<span class="${cls}" title="${iso(c)}"></span>`;
    }
    heatHTML += `<div class="hrow"><span class="hlabel">${start.getDate()}/${start.getMonth() + 1}</span>
      <div class="hcells">${cells}</div>
      <span class="hcount ${count >= 4 ? "ok" : ""}">${count}/4${deload ? " ·D" : ""}</span></div>`;
  }
  document.getElementById("heat").innerHTML = heatHTML;

  // strength progression
  const GROUPS = [
    [1, "Empuje"],
    [3, "Tracción"],
    [4, "Piernas"],
  ];
  const palette = ["#4f8cff", "#3fae6b", "#e0a13c", "#c65fb0", "#5bc0be", "#e2725b"];
  const host = document.getElementById("strength");
  for (const [dayId, gname] of GROUPS) {
    const rows = d.strength.filter((r) => r.day_id === dayId);
    const box = document.createElement("div");
    if (!rows.length) {
      box.className = "muted small";
      box.textContent = `${gname}: sin registros`;
      host.appendChild(box);
      continue;
    }
    box.className = "subchart";
    const cid = `cS${dayId}`;
    box.innerHTML = `<div class="muted small">${gname}</div><div class="cw sm"><canvas id="${cid}"></canvas></div>`;
    host.appendChild(box);
    if (!hasChart) continue;
    const labels = [...new Set(rows.map((r) => r.date))].sort();
    const exIds = [...new Set(rows.map((r) => r.exercise_id))];
    const datasets = exIds.map((exId, idx) => {
      const src = rows.filter((r) => r.exercise_id === exId);
      const at = (lb) => src.find((x) => x.date === lb);
      return {
        label: src[0].exercise_name,
        data: labels.map((lb) => {
          const r = at(lb);
          return r ? +((r.reps * 40) / r.work_sec).toFixed(1) : null;
        }),
        spanGaps: true,
        borderColor: palette[idx % palette.length],
        backgroundColor: palette[idx % palette.length],
        pointStyle: labels.map((lb) => (at(lb)?.is_deload ? "triangle" : "circle")),
        pointRadius: labels.map((lb) => (at(lb)?.is_deload ? 6 : 3)),
        borderWidth: 2,
        tension: 0.25,
      };
    });
    state.charts.push(
      new Chart(document.getElementById(cid), { type: "line", data: { labels, datasets }, options: lineOpts() })
    );
  }
}

// ------------------------------- boot ---------------------------------
navigator.serviceWorker?.register("/sw.js").catch(() => {});
router();
