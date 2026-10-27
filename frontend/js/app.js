import { api } from "./api.js";
import { buildSteps, TimerEngine, primaryLabel, readMuted, writeMuted, autopauseState, ACTIVE } from "./timer.js";
import { dialText, ringFraction, changedIndices, beatAt } from "./fx.js";
import { loadOptions, platesText, targetsFor, detectPRs } from "./plates.js";
import { musclesFor, bodyMapSVG, bestView } from "./muscles.js";
import { techniqueSVG, hasTechnique, techniqueKind } from "./technique.js";
import { weekProgress, nextDayId, mondayISO, stepValue, holdInterval, groupByWeek } from "./stats.js";
import {
  withAvg,
  deltaOver,
  goalProgress,
  monthCounts,
  bestWeekStreak,
  heatWeeks,
  strengthByDay,
  inRange,
  sparkPath,
  weightSummary,
} from "./dash.js";

const app = document.getElementById("app");
const APP_VERSION = "19"; // = número de la caché en sw.js; se muestra en el inicio
const state = { boot: null, run: null, engine: null };

const todayISO = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD local
const h = (html) => {
  app.classList.remove("loading");
  app.innerHTML = html;
};
app.addEventListener("animationend", (e) => {
  if (e.target.parentElement === app) app.classList.remove("entering");
});
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

// localStorage puede lanzar (modo privado / bloqueado): readMuted/writeMuted lo toleran.
const storage = () => {
  try {
    return window.localStorage;
  } catch (_) {
    return undefined;
  }
};

const dayById = (id) => state.boot.days.find((d) => d.id === +id);
const warmupExercises = () => (dayById(0)?.exercises || []).filter((e) => e.block === "warmup");
const mainExercises = (day) => day.exercises.filter((e) => e.block === "main");
const remateExercises = (day) => day.exercises.filter((e) => e.block === "remate");
const stretchExercises = (day) => day.exercises.filter((e) => e.block === "stretch");

// Iconos de línea (Lucide, ISC): mismo trazo en toda la app.
const ico = (body) =>
  `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const SPEAKER = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>';
const ICON = {
  home: ico('<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>'),
  scale: ico('<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>'),
  back: ico('<polygon points="19 20 9 12 19 4 19 20"/><line x1="5" x2="5" y1="19" y2="5"/>'),
  skip: ico('<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19"/>'),
  soundOn: ico(SPEAKER + '<path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>'),
  soundOff: ico(SPEAKER + '<line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>'),
  chevronLeft: ico('<path d="m15 18-6-6 6-6"/>'),
  minus: ico('<path d="M5 12h14"/>'),
  chevronRight: ico('<path d="m9 18 6-6-6-6"/>'),
  expand: ico('<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/>'),
  close: ico('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  check: ico('<path d="M20 6 9 17l-5-5"/>'),
  trophy: ico('<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>'),
  play: ico('<polygon points="6 3 20 12 6 21 6 3"/>'),
  logout: ico('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>'),
  flame: ico('<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>'),
  chart: ico('<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>'),
  pen: ico('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  ruler: ico('<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/>'),
  history: ico('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>'),
  plus: ico('<path d="M5 12h14"/><path d="M12 5v14"/>'),
};

/** Cabecera común: atrás de cristal (opcional) + título centrado. */
const topBar = (title, back = "#/") => `
  <header class="top">
    ${back ? `<a class="back glass" href="${back}" aria-label="Atrás">${ICON.chevronLeft}</a>` : "<span></span>"}
    <h2>${title}</h2><span></span>
  </header>`;

/** Fila con interruptor (mismo componente que la autopausa). */
const switchRow = (label, attrs = "") =>
  `<label class="switch-row"><span>${label}</span><input type="checkbox" role="switch" class="switch" ${attrs} /></label>`;


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
      state.flush = api.flushPending(); // el inicio lo espera antes de pedir sesiones
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
  // Un <dialog> quitado del DOM no emite "close": soltar aquí el bloqueo de scroll.
  document.documentElement.classList.remove("noscroll");
  // La animación de entrada solo al cambiar de ruta, no en cada re-render
  // de la misma vista (stepper de rondas, guardar medida...).
  app.classList.add("entering");
  paintTabs(hash === "" ? "#/" : hash);
  for (const [re, view] of routes) {
    const m = hash.match(re);
    if (m) return view(...m.slice(1));
  }
  location.hash = "#/";
}
window.addEventListener("hashchange", router);

// ----------------------------- pestañas --------------------------------
const TABS = [
  ["#/", "Inicio", "home"],
  ["#/measure", "Peso", "scale"],
  ["#/dashboard", "Progreso", "chart"],
  ["#/history", "Historial", "history"],
];
const tabbar = document.createElement("nav");
tabbar.className = "tabbar";
tabbar.setAttribute("aria-label", "Secciones");
tabbar.hidden = true;
tabbar.innerHTML = TABS.map(([href, label, icon]) => `<a class="tab" href="${href}">${ICON[icon]}${label}</a>`).join("");
document.body.append(tabbar);
function paintTabs(hash) {
  const on = TABS.some(([href]) => href === hash);
  tabbar.hidden = !on;
  document.body.classList.toggle("has-tabs", on);
  for (const a of tabbar.querySelectorAll(".tab")) {
    const cur = a.getAttribute("href") === hash;
    a.classList.toggle("on", cur);
    if (cur) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}

// ------------------------------- login ---------------------------------
// PIN en puntos (referencia 21st.dev: OTP PIN Field). El input real está
// encima, transparente: el toque abre el teclado y los gestores de claves funcionan.
function viewLogin() {
  h(`
    <div class="pane center login">
      <div class="login-mark" aria-hidden="true">
        <svg viewBox="0 0 44 44"><circle class="ring-track" cx="22" cy="22" r="18" /><circle class="wring-fill" cx="22" cy="22" r="18" stroke-dasharray="${RING_S}" stroke-dashoffset="${RING_S * 0.25}" /></svg>
      </div>
      <h1 class="brand login-title">Entreno</h1>
      <p class="muted login-sub">Introduce tu PIN para empezar</p>
      <form id="f" class="card col gap login-card">
        <label class="pin-wrap" for="pin">
          <span class="pin-dots" id="dots" aria-hidden="true"></span>
          <input id="pin" class="pin-input" type="password" inputmode="numeric" autocomplete="current-password" maxlength="12" autofocus aria-label="PIN" />
        </label>
        <button class="primary big-btn">Entrar</button>
        <p id="err" class="err" role="alert"></p>
      </form>
    </div>`);
  const pin = document.getElementById("pin");
  const dots = document.getElementById("dots");
  const paintDots = () => {
    const n = pin.value.length;
    const slots = Math.max(4, n);
    dots.innerHTML = Array.from({ length: slots }, (_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join("");
  };
  pin.addEventListener("input", () => {
    document.getElementById("err").textContent = "";
    paintDots();
  });
  paintDots();
  document.getElementById("f").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api.login(pin.value);
      state.boot = null;
      location.hash = "#/";
      router();
    } catch (_) {
      document.getElementById("err").textContent = "PIN incorrecto";
      replay(document.querySelector(".login-card"), "shake");
      pin.value = "";
      paintDots();
      pin.focus();
    }
  });
}

// ------------------------------- home ----------------------------------
// Últimas sesiones (solo fecha y día) en localStorage: el inicio pinta la
// racha y el "entreno de hoy" al instante y sin red; luego se refresca.
const RECENT_KEY = "entreno.recent";
const readRecent = () => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "null");
  } catch (_) {
    return null;
  }
};
const writeRecent = (list) => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.map(({ date, day_id }) => ({ date, day_id }))));
  } catch (_) {}
};
// Pesos (fecha y kg) en localStorage: la tarjeta de peso del inicio pinta al instante.
const WEIGHTS_KEY = "entreno.weights";
const readWeights = () => {
  try {
    return JSON.parse(localStorage.getItem(WEIGHTS_KEY) || "null");
  } catch (_) {
    return null;
  }
};
const writeWeights = (list) => {
  try {
    localStorage.setItem(WEIGHTS_KEY, JSON.stringify(list.filter((m) => m.weight_kg != null).map(({ date, weight_kg }) => ({ date, weight_kg }))));
  } catch (_) {}
};
const PLAN_DAYS = [1, 2, 3, 4];
const estMinutes = (day) =>
  Math.round(
    buildSteps(day, warmupExercises(), { rounds: day.rounds, remates: [], stretches: stretchExercises(day) }).reduce((a, x) => a + x.seconds, 0) / 60
  );
const RING_S = 2 * Math.PI * 18; // anillo semanal (r=18 en un viewBox de 44)

/** "↑ Hoy sube: Press de pecho a 9 kg (+1)" a partir del "hoy toca" del día. */
function upsText(day, targets) {
  const ups = mainExercises(day).filter((e) => targets?.[e.id]?.action === "up");
  if (!ups.length) return "";
  const first = `${esc(ups[0].name)} a ${kgLabel(targets[ups[0].id].kg)}`;
  return `↑ Hoy sube: ${first}${ups.length > 1 ? ` (+${ups.length - 1})` : ""}`;
}

function weightCardHTML(weights) {
  const st = state.boot.settings || {};
  const ws = weightSummary(weights || [], todayISO(), st.goal_weight_kg ?? null, st.phase);
  if (!ws)
    return `<a class="card wcard" href="#/measure"><span class="wico">${ICON.scale}</span>
      <span class="wtxt"><strong>Apunta tu peso</strong><span class="muted small">En ayunas, a primera hora</span></span></a>`;
  const when = ws.today ? "Peso de hoy" : `Peso de hoy · sin apuntar`;
  const ago = ws.today ? "" : ` <small>kg · ${fmtDay(ws.last.date)}</small>`;
  const delta = ws.delta7 == null ? "" : `${ws.delta7 > 0 ? "+" : ws.delta7 < 0 ? "−" : "±"}${kgLabel(Math.abs(ws.delta7))} en 7 días`;
  const goal = ws.toGoal == null ? "" : ws.toGoal > 0 ? `faltan ${kgLabel(ws.toGoal)}` : "¡objetivo alcanzado!";
  return `<a class="card wcard${ws.today ? " done" : ""}" href="#/measure" aria-label="${when}: ${kgLabel(ws.last.kg)}">
    <span class="wico">${ws.today ? ICON.check : ICON.scale}</span>
    <span class="wtxt">
      <span class="muted small">${when}</span>
      <span class="wval">${String(ws.last.kg).replace(".", ",")}${ago || " <small>kg</small>"}</span>
      <span class="muted small">${[delta, goal].filter(Boolean).join(" · ")}</span>
    </span>
    ${ws.spark.length > 1 ? spark(ws.spark, cssVar("--c-rest"), 64, 28, "spark wspark") : ""}
  </a>`;
}

function homeHTML(serverSessions, weights) {
  const pend = api.pendingCount();
  const known = Array.isArray(serverSessions);
  // Los entrenos en cola (sin red) van primero: son los más recientes.
  const sessions = known ? [...api.pendingSessions(), ...serverSessions] : null;
  const wk = weekProgress(known ? sessions : [], todayISO());
  const todayId = nextDayId(known ? sessions : [], PLAN_DAYS);
  const today = dayById(todayId);
  const frac = Math.min(1, wk.done / wk.goal);
  const trainedToday = known && sessions.some((x) => String(x.date).slice(0, 10) === todayISO());
  const dateTxt = new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
  const chip = (d) =>
    d.id === 5
      ? `<a class="chip" href="#/manual" style="--day: var(--d5)">${ICON.plus}Libre</a>`
      : `<a class="chip" href="#/setup/${d.id}" style="--day: var(--d${d.id})"><i></i>${esc(d.name)}</a>`;
  const others = state.boot.days.filter((d) => d.id >= 1 && (!known || d.id !== todayId));
  return `
    <div class="pane home">
      <header class="home-top">
        <span class="muted small home-date">${dateTxt[0].toUpperCase() + dateTxt.slice(1)}</span>
        <h1 class="brand">Entreno</h1>
      </header>
      ${pend ? `<div class="note warn">${pend} guardado(s) sin subir — se enviarán al reconectar</div>` : ""}
      <section class="card week ${!known ? "skel" : wk.done >= wk.goal ? "complete" : ""}" aria-label="Progreso semanal">
        <svg class="wring" viewBox="0 0 44 44" aria-hidden="true">
          <circle class="ring-track" cx="22" cy="22" r="18" />
          <circle class="wring-fill" cx="22" cy="22" r="18"
            stroke-dasharray="${RING_S}" stroke-dashoffset="${RING_S * (1 - frac)}" />
        </svg>
        <div class="week-num"><b>${wk.done}</b><span>/${wk.goal}</span></div>
        <div class="col week-text">
          <strong>${!known ? "Cargando tu semana…" : wk.done >= wk.goal ? "¡Semana cumplida!" : `Esta semana: ${wk.done} de ${wk.goal}`}</strong>
          <span class="muted small streak">${ICON.flame}${
            wk.streak ? `Racha: ${wk.streak} ${wk.streak === 1 ? "semana" : "semanas"} cumpliendo` : `Cumple ${wk.goal} días y empieza una racha`
          }</span>
        </div>
      </section>
      ${
        today && known
          ? `<a class="card today" href="#/setup/${today.id}" style="--day: var(--d${today.id})">
        <span class="eyebrow">${trainedToday ? "Hoy ya has entrenado · siguiente" : "Entreno de hoy"}</span>
        <strong class="today-name">Día ${today.id} — ${esc(today.name)}</strong>
        <span class="muted small">${esc(mainExercises(today).map((e) => e.name).join(" · "))}</span>
        <span class="small today-up" id="todayUp">${upsText(today, state.targets[today.id])}</span>
        <span class="row between today-foot">
          <span class="pill">${today.rounds} rondas · ~${estMinutes(today)} min</span>
          <span class="today-go">${ICON.play} Empezar</span>
        </span>
      </a>`
          : ""
      }
      ${weightCardHTML(weights)}
      <h3 class="section-title">Otro día</h3>
      <div class="chips">${others.map(chip).join("")}</div>
      <div class="muted small version">Entreno v${APP_VERSION}</div>
    </div>`;
}

/** Cerrar sesión (ahora vive al final del Historial). */
async function logout() {
  try {
    await api.logout();
  } catch (_) {
    toast("Sin conexión: no se puede cerrar sesión ahora");
    return;
  }
  state.boot = null;
  try {
    storage()?.removeItem(RECENT_KEY);
    storage()?.removeItem(WEIGHTS_KEY);
  } catch (_) {}
  location.hash = "#/login";
  router();
}

function viewHome() {
  const mine = (state.homeTok = (state.homeTok || 0) + 1); // otra visita más reciente manda
  let sessions = readRecent();
  let weights = readWeights();
  let shown = homeHTML(sessions, weights);
  h(shown);
  const repaint = () => {
    if (state.homeTok !== mine || (location.hash !== "#/" && location.hash !== "")) return; // ya se ha ido
    const html = homeHTML(sessions, weights);
    if (html === shown) return;
    app.classList.remove("entering"); // repintar sin repetir la animación
    h(html);
    shown = html;
  };
  // "↑ Hoy sube": el hoy toca del día que toca (se carga aparte; sin red, nada).
  const loadUps = () => {
    const today = dayById(nextDayId([...api.pendingSessions(), ...(sessions || [])], PLAN_DAYS));
    if (today) loadTargets(today).then(repaint);
  };
  // Tras subir la cola pendiente (si la hay), para que no falte nada.
  Promise.resolve(state.flush)
    .catch(() => {})
    .then(() => api.sessions(200)) // ~1 año a 4/semana: la racha no se trunca
    .then((list) => {
      writeRecent(list);
      sessions = list;
      repaint();
      loadUps();
    })
    .catch(() => {}); // sin red: se queda con lo cacheado
  api
    .measurements()
    .then((list) => {
      writeWeights(list);
      weights = list;
      repaint();
    })
    .catch(() => {});
}

// ----------------------------- hoy toca --------------------------------
// Peso recomendado por ejercicio (doble progresión, js/plates.js).
const UNIT = { pair: "por mancuerna", single: "en la mancuerna", bar: "en la barra" };
const weighted = (e) => e.equipment && e.equipment !== "bodyweight";
const kgLabel = (kg) => (kg == null ? "—" : `${String(kg).replace(".", ",")} kg`);
state.targets = {}; // dayId → targets (caché de la sesión)
state.lastLogs = {}; // dayId → historial crudo de /api/last_logs
async function loadTargets(day) {
  try {
    const last = await api.lastLogs(day.id);
    state.lastLogs[day.id] = last;
    state.targets[day.id] = targetsFor(day.exercises, last);
  } catch (_) {
    state.targets[day.id] ||= targetsFor(day.exercises, {});
  }
  return state.targets[day.id];
}
const ACTION = {
  up: (t) => `<span class="badge up">↑ sube de ${kgLabel(t.from)}</span>`,
  down: (t) => `<span class="badge down">↓ baja de ${kgLabel(t.from)}</span>`,
  hold: () => `<span class="badge">= mantén</span>`,
  start: () => `<span class="badge">elige peso</span>`,
};
function hoyTocaHTML(day, targets) {
  const exs = [...mainExercises(day), ...remateExercises(day)];
  const w = exs.filter(weighted);
  const bw = exs.filter((e) => !weighted(e));
  if (!targets) return `<div class="muted small">Calculando…</div>`;
  return `
    ${w
      .map((e) => {
        const t = targets[e.id] || {};
        return `<div class="hoy-row" style="--day: var(--d${day.id})">
          <div class="hoy-name"><strong>${esc(e.name)}</strong>
            <span class="muted small">${t.rep_min ? `${t.rep_min}–${t.rep_max} reps` : "sin rango de reps"}${
          t.last ? ` · última: ${kgLabel(t.last.kg)}${t.last.reps.length ? " × " + t.last.reps.join("/") : ""}` : ""
        }</span></div>
          <div class="hoy-kg"><b>${t.kg == null ? "—" : kgLabel(t.kg)}</b>
            <span class="muted small">${t.kg == null ? "apúntalo hoy" : UNIT[e.equipment] || ""}</span>
            ${t.plates ? `<span class="small hoy-plates">${t.plates}</span>` : ""}
            ${(ACTION[t.action] || ACTION.hold)(t)}</div>
        </div>`;
      })
      .join("")}
    ${bw.length ? `<div class="muted small">Peso corporal: ${bw.map((e) => esc(e.name)).join(" · ")}</div>` : ""}`;
}

// ------------------------------- setup ---------------------------------
function viewSetup(dayId) {
  const day = dayById(dayId);
  if (!day) return (location.hash = "#/");
  let rounds = day.rounds;
  let deload = false;
  let stretch = true; // estiramientos al final (se pueden saltar hoy)
  const stretchMin = Math.round(stretchExercises(day).reduce((a, e) => a + (e.work_sec ?? 30), 10) / 60);
  // Autopausa: por ejercicio (main + remate); el interruptor general los cambia todos.
  const apExercises = [...mainExercises(day), ...remateExercises(day)];
  const setAutopause = (ids, on) => {
    const updates = ids.map((id) => ({ id, autopause: on }));
    // En memoria ya: vale para este entreno aunque no haya red.
    for (const e of apExercises) if (ids.includes(e.id)) e.autopause = on;
    api.setAutopause(updates).catch((err) => {
      if (err.message === "no auth") return; // req() ya manda al login
      toast(navigator.onLine === false
        ? "Sin conexión: la autopausa vale solo para este entreno"
        : "No se pudo guardar la autopausa: vale solo para este entreno");
    });
    paintAutopause();
  };
  // Repinta solo los interruptores (sin re-render: no salta el scroll ni el foco).
  const paintAutopause = () => {
    const st = autopauseState(apExercises);
    const all = document.getElementById("ap-all");
    all.checked = st === "all";
    all.indeterminate = st === "some";
    document.querySelectorAll(".ap-list .switch").forEach((el) => {
      el.checked = !!apExercises.find((e) => e.id === +el.dataset.ex)?.autopause;
    });
  };

  const targetsReady = loadTargets(day);
  targetsReady.then((t) => {
    const box = document.getElementById("hoy");
    if (box && location.hash === `#/setup/${day.id}`) box.innerHTML = hoyTocaHTML(day, t);
  });
  const draw = () => {
    const shown = deload ? day.rounds_deload : rounds;
    h(`
      <div class="pane">
        ${topBar(`Día ${day.id} — ${esc(day.name)}`)}
        <div class="card col gap">
          <div class="muted small">${esc(day.focus || "")} · ${day.work_sec}s / ${day.rest_ex_sec}s / ${day.rest_round_sec}s</div>
          <label>Rondas</label>
          <div class="stepper">
            <button id="minus" class="glass" aria-label="Menos rondas" ${deload ? "disabled" : ""}>${ICON.minus}</button>
            <span class="big">${shown}</span>
            <button id="plus" class="glass" aria-label="Más rondas" ${deload ? "disabled" : ""}>${ICON.plus}</button>
          </div>
          ${switchRow(`Semana de deload (${day.rounds_deload} rondas)`, `id="deload" ${deload ? "checked" : ""}`)}
          ${stretchExercises(day).length ? switchRow(`Estiramientos al final (~${stretchMin} min)`, `id="stretch" ${stretch ? "checked" : ""}`) : ""}
        </div>
        <div class="card col gap hoy">
          <div class="row between"><strong>Hoy toca</strong><span class="muted small">peso de discos</span></div>
          <div id="hoy">${hoyTocaHTML(day, state.targets[day.id])}</div>
        </div>
        <div class="card col gap ap">
          <label class="switch-row">
            <span><strong>Autopausa</strong><br />
              <span class="muted small">Para antes del ejercicio hasta que pulses Continuar</span></span>
            <input type="checkbox" role="switch" class="switch" id="ap-all" />
          </label>
          <div class="ap-list">
            ${apExercises
              .map(
                (e) => `<label class="switch-row small">
                  <span>${esc(e.name)}${e.block === "remate" ? ' <span class="muted">· remate</span>' : ""}</span>
                  <input type="checkbox" role="switch" class="switch" data-ex="${e.id}" ${e.autopause ? "checked" : ""} />
                </label>`
              )
              .join("")}
          </div>
        </div>
        <button class="primary big-btn" id="go">Empezar entreno</button>
      </div>`);
    document.getElementById("minus").onclick = () => { rounds = Math.max(day.rounds_min, rounds - 1); draw(); };
    document.getElementById("plus").onclick = () => { rounds = Math.min(day.rounds_max, rounds + 1); draw(); };
    document.getElementById("deload").onchange = (e) => { deload = e.target.checked; draw(); };
    const st = document.getElementById("stretch");
    if (st) st.onchange = (e) => { stretch = e.target.checked; };
    paintAutopause();
    document.getElementById("ap-all").onchange = () =>
      setAutopause(apExercises.map((e) => e.id), autopauseState(apExercises) !== "all");
    document.querySelectorAll(".ap-list .switch").forEach((el) => {
      el.onchange = () => setAutopause([+el.dataset.ex], el.checked);
    });
    document.getElementById("go").onclick = async () => {
      await Promise.race([targetsReady, new Promise((r) => setTimeout(r, 1500))]); // sin red no bloquea
      state.run = {
        day,
        rounds: deload ? day.rounds_deload : rounds,
        isDeload: deload,
        date: todayISO(),
        source: "timer",
        targets: state.targets[day.id] || null,
        lastLogs: state.lastLogs[day.id] || {},
        roundLog: {}, // exId → {ronda: reps} apuntadas en el descanso
        stretch,
      };
      location.hash = "#/run";
    };
  };
  draw();
}

// ------------------------------- run -----------------------------------
const PREP_SEC = 5; // cuenta atrás al Iniciar y al Continuar tras una autopausa
const RING_C = 2 * Math.PI * 54; // circunferencia del anillo (r=54 en un viewBox de 120)

/** Reinicia una animación CSS de un solo uso (quitar clase, reflow, poner). */
const replay = (el, cls) => {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
};

/** Añade a cada paso el "hoy toca" de su ejercicio, y a cada paso el del
 *  siguiente ejercicio (para el descanso y la voz: "…, 8 kilos"). */
function annotate(steps, targets) {
  for (const st of steps) st.target = targets && st.exerciseId != null ? targets[st.exerciseId] || null : null;
  for (let i = 0; i < steps.length; i++) {
    const nxt = steps.slice(i + 1).find((x) => ACTIVE.has(x.kind));
    // El descanso justo después de un ejercicio sirve para apuntar sus reps.
    const prev = steps[i - 1];
    steps[i].prevWork =
      steps[i].kind === "rest" && prev?.kind === "work" && prev.exerciseId != null
        ? { exerciseId: prev.exerciseId, round: prev.phase === "Remate" ? 1 : prev.round || 1, name: prev.name }
        : null;
    // El descanso enseña los músculos del ejercicio que viene.
    steps[i].nextMuscle = nxt?.muscle ?? null;
    steps[i].nextMuscle2 = nxt?.muscle2 ?? null;
    const t = nxt?.target;
    steps[i].nextTarget = t && t.kg != null && t.equipment !== "bodyweight" ? t : null;
    steps[i].nextKg = steps[i].nextTarget?.kg ?? null;
    steps[i].nextAction = steps[i].nextTarget?.action ?? null;
  }
  return steps;
}
/** Técnica: inicio y final (o una postura) del ejercicio. Tocar amplía/reduce. */
function techniqueHTML(exId, name) {
  if (!hasTechnique(exId)) return "";
  const box = (which, label) =>
    `<figure class="tq-box"><figcaption>${label}</figcaption>${techniqueSVG(exId, which, { label: name })}</figure>`;
  const imgs = techniqueKind(exId) === "hold" ? box("hold", "Posición") : box("start", "Inicio") + box("end", "Final");
  return `<h4 class="tq-title">Técnica</h4>
    <button type="button" class="tq-pair ${techniqueKind(exId)}" aria-pressed="false" aria-label="Ampliar imágenes de técnica">${imgs}</button>`;
}
const tgtText = (t) => (t && t.kg != null ? `${kgLabel(t.kg)} ${UNIT[t.equipment] || ""}${t.plates ? " · " + t.plates : ""}` : "");
// Chip del runner en dos líneas: kg en negrita, discos debajo (solo números y constantes).
// Subir / bajar se anuncia con flecha y verbo (no solo color): "↑ Sube a 9 kg".
const SHIFT = { up: "↑ Sube a ", down: "↓ Baja a " };
const tgtHTML = (t, prefix = "") =>
  t && t.kg != null
    ? `<b>${SHIFT[t.action] || prefix}${kgLabel(t.kg)} ${UNIT[t.equipment] || ""}</b>` +
      (t.action === "up" || t.action === "down" ? `<span>antes ${kgLabel(t.from)}${t.plates ? " · " + t.plates : ""}</span>` : t.plates ? `<span>${t.plates}</span>` : "")
    : "";

function viewRun() {
  const r = state.run;
  if (!r) return (location.hash = "#/");
  const { day } = r;
  let totalDuration = 0;
  let muted = readMuted(storage());

  const steps = annotate(buildSteps(day, warmupExercises(), { rounds: r.rounds, remates: [] }), r.targets);

  h(`
    <div class="pane run" id="runpane">
      <div class="run-top">
        <span id="phase" class="phase">Preparado</span>
        <span id="round" class="rnd"></span>
        <button id="mute" class="mute glass" type="button" aria-label="Silenciar sonido y voz" aria-pressed="false"></button>
      </div>
      <div id="dial" class="dial">
        <svg class="ring" viewBox="0 0 120 120" aria-hidden="true">
          <circle class="ring-track" cx="60" cy="60" r="54" />
          <circle id="halo" class="ring-halo" cx="60" cy="60" r="54"
            stroke-dasharray="${RING_C}" stroke-dashoffset="0" />
          <circle id="ring" class="ring-fill" cx="60" cy="60" r="54"
            stroke-dasharray="${RING_C}" stroke-dashoffset="0" />
        </svg>
        <div id="digits" class="digits" role="timer"></div>
      </div>
      <div id="exname" class="exname"></div>
      <div class="exmeta">
        <button type="button" id="mapbtn" class="mapbtn" aria-label="Ver los músculos en grande"></button>
        <div class="exmeta-txt">
          <div id="exmus" class="muted"></div>
          <div id="extgt" class="tgt" hidden></div>
        </div>
      </div>
      <div id="exinfo" class="instructions" role="button" tabindex="0" title="Toca para verlo entero"></div>
      <div id="restlog" class="restlog" hidden>
        <span id="rlLabel" class="small"></span>
        <div class="rep-step">
          <button type="button" class="glass round" data-step="-1" aria-label="Una rep menos">${ICON.minus}</button>
          <input id="rlInput" class="reps" type="number" inputmode="numeric" min="0" max="999" placeholder="—" aria-label="Reps de la ronda que acabas de hacer" />
          <button type="button" class="glass round" data-step="1" aria-label="Una rep más">${ICON.plus}</button>
        </div>
        <button type="button" id="rlSave" class="rl-save">Guardar</button>
      </div>
      <div id="next" class="next"></div>
      <div class="bar"><div id="fill" class="fill"></div></div>
      <div class="run-controls">
        <button id="back" class="glass" aria-label="Paso anterior">${ICON.back}</button>
        <button id="pp" class="go">${primaryLabel("idle")}</button>
        <button id="skip" class="glass" aria-label="Paso siguiente">${ICON.skip}</button>
      </div>
      <button class="ghost small" id="exit">Salir sin guardar</button>
      <div id="overlay" class="overlay"></div>
      <dialog id="mapzoom" class="sheet" aria-labelledby="mapTitle">
        <div class="sheet-grip" aria-hidden="true"></div>
        <header class="sheet-head">
          <h3 id="mapTitle"></h3>
          <button class="glass round" id="mapClose" aria-label="Cerrar">${ICON.close}</button>
        </header>
        <div id="mapTech" class="tq-sec-wrap"></div>
        <div id="mapBig" class="map-big"></div>
        <div id="mapLegend" class="legend small"></div>
        <p id="mapInfo" class="muted map-info"></p>
      </dialog>
    </div>`);

  const $ = (id) => document.getElementById(id);

  // Dígitos: un span por carácter; solo se anima el que cambia.
  const setDial = (sec) => {
    const el = $("digits");
    const text = dialText(sec);
    const prev = el.dataset.t || "";
    if (prev === text) return;
    if (prev.length !== text.length) {
      el.replaceChildren(...[...text].map(() => document.createElement("span")));
      el.dataset.len = String(text.length);
    }
    const spans = el.children;
    for (const k of changedIndices(prev, text)) {
      spans[k].textContent = text[k];
      if (prev) replay(spans[k], "roll");
    }
    el.dataset.t = text;
    el.setAttribute("aria-label", fmt(sec));
  };
  const setRing = (remainingMs, step) => {
    const off = String(RING_C * (1 - ringFraction(remainingMs, step.seconds)));
    $("ring").style.strokeDashoffset = off;
    $("halo").style.strokeDashoffset = off;
  };
  let lastSec = null;
  const onTick = (sec, step, i, remainingMs = step.seconds * 1000) => {
    setDial(sec);
    setRing(remainingMs, step);
    const st = state.engine?.status;
    if ((st === "running" || st === "countdown") && beatAt(lastSec, sec)) replay($("dial"), "beat");
    lastSec = sec;
  };

  const paint = (step, i) => {
    const total = state.engine?.steps.length || steps.length;
    $("runpane").dataset.kind = step.kind;
    $("round").textContent =
      step.round > 0 && step.kind !== "warmup" && step.kind !== "stretch" && step.phase !== "Remate"
        ? `Ronda ${step.round}/${step.totalRounds}`
        : step.phase === "Remate"
        ? "Remate"
        : "";
    $("exname").textContent = step.name;
    // Mapa muscular: el del ejercicio; en el descanso, el del siguiente.
    const isRest = step.kind === "rest";
    const mus = isRest ? step.nextMuscle : step.muscle;
    const mus2 = isRest ? step.nextMuscle2 : step.muscle2;
    const zones = musclesFor(mus, mus2);
    const hasMap = zones.primary.size + zones.secondary.size > 0;
    $("mapbtn").hidden = !hasMap;
    // En pequeño, solo la vista donde trabaja lo principal: se ve el doble de grande.
    $("mapbtn").innerHTML = hasMap ? bodyMapSVG(zones, { label: isRest ? step.nextName : step.name, view: bestView(zones) }) : "";
    const exId = isRest ? step.nextExerciseId : step.exerciseId;
    mapCtx = { zones, exId, name: isRest ? step.nextName : step.name, mus, mus2, info: isRest ? step.nextInstructions : step.instructions };
    $("mapbtn").classList.toggle("has-tq", hasTechnique(exId));
    $("mapbtn").setAttribute("aria-label", hasTechnique(exId) ? "Ver técnica y músculos" : "Ver los músculos en grande");
    $("exmus").textContent = (isRest ? (mus ? "Siguiente · " + mus : "") : mus) || step.note || "";
    // Peso del ejercicio en curso; en el descanso, el del siguiente ("prepara").
    const tg = step.kind === "work" ? tgtHTML(step.target) : step.kind === "rest" && step.nextTarget ? tgtHTML(step.nextTarget, "Prepara ") : "";
    $("extgt").innerHTML = tg;
    $("extgt").dataset.shift = (step.kind === "work" ? step.target : step.nextTarget)?.action || "";
    $("extgt").hidden = !tg;
    const info = (step.kind === "rest" ? step.nextInstructions : step.instructions) || "";
    // Descanso tras un ejercicio: en el hueco de las instrucciones se apuntan sus reps
    // (las del siguiente siguen a un toque, en el mapa).
    const pw = step.kind === "rest" ? step.prevWork : null;
    $("restlog").hidden = !pw;
    $("exinfo").hidden = !!pw;
    if (pw) {
      $("rlLabel").textContent = `¿Cuántas en ${pw.name} · R${pw.round}?`;
      const inp = $("rlInput");
      inp.dataset.ex = pw.exerciseId;
      inp.dataset.round = pw.round;
      const done = r.roundLog?.[pw.exerciseId]?.[pw.round];
      const lastSame = (r.lastLogs?.[pw.exerciseId] || r.lastLogs?.[String(pw.exerciseId)] || [])[0]?.rounds?.find((x) => x.round === pw.round)?.reps;
      inp.value = done ?? lastSame ?? "";
      inp.classList.toggle("ghosted", done == null); // sugerido, aún no apuntado
      markSaved(done != null);
    }
    $("exinfo").textContent = info;
    // Sin texto no es un botón (accesibilidad).
    $("exinfo").tabIndex = info ? 0 : -1;
    $("exinfo").toggleAttribute("role", !!info);
    if (info) $("exinfo").setAttribute("role", "button");
    $("next").textContent = "Siguiente: " + step.nextName + (step.nextAutopause ? " · se parará" : "");
    lastSec = null;
    setDial(step.seconds);
    setRing(step.seconds * 1000, step);
    replay($("exname"), "enter");
    replay($("exinfo"), "enter");
    $("fill").style.width = `${((i + 1) / total) * 100}%`;
    updatePP();
  };

  // Botón del descanso: "Guardar" mientras falte confirmar; "✓ Guardado" después.
  const markSaved = (saved) => {
    const b = $("rlSave");
    b.classList.toggle("saved", saved);
    b.innerHTML = saved ? `${ICON.check}Guardado` : "Guardar";
    b.setAttribute("aria-label", saved ? "Reps guardadas" : "Guardar reps de esta ronda");
  };

  const updatePP = () => {
    const e = state.engine;
    const status = e ? e.status : "idle";
    $("pp").textContent = primaryLabel(status);
    $("pp").disabled = status === "done";
    // Antes de iniciar: "Preparado" en vez de la fase del primer paso.
    const step = e ? e.step : steps[0];
    $("phase").textContent =
      status === "idle"
        ? "Preparado"
        : status === "waiting"
        ? "Listo cuando quieras"
        : status === "countdown"
        ? "Prepárate"
        : step.phase;
    $("runpane").dataset.status = status;
  };

  let mapCtx = null;
  const openMap = () => {
    if (!mapCtx) return;
    const dlg = $("mapzoom");
    $("mapTitle").textContent = mapCtx.name || "Músculos";
    $("mapBig").innerHTML = bodyMapSVG(mapCtx.zones, { label: mapCtx.name });
    $("mapLegend").innerHTML =
      (mapCtx.mus ? `<span class="lg"><i class="lg-sq" style="--day: var(--phase)"></i>Principal: ${esc(mapCtx.mus)}</span>` : "") +
      (mapCtx.mus2 ? `<span class="lg"><i class="lg-sq sec"></i>Secundario: ${esc(mapCtx.mus2)}</span>` : "");
    $("mapInfo").textContent = mapCtx.info || "";
    $("mapTech").innerHTML = techniqueHTML(mapCtx.exId, mapCtx.name);
    const tq = $("mapTech").querySelector(".tq-pair");
    if (tq) tq.onclick = () => tq.setAttribute("aria-pressed", String(tq.classList.toggle("zoom")));
    dlg.showModal();
  };
  const paintMute = () => {
    const b = $("mute");
    b.innerHTML = muted ? ICON.soundOff : ICON.soundOn;
    b.setAttribute("aria-pressed", String(muted));
    b.title = muted ? "Sonido desactivado" : "Sonido activado";
  };

  const makeEngine = (stp, onDone, finalCue = true) =>
    new TimerEngine(stp, {
      onTick,
      onStep: paint,
      onDone,
      muted,
      finalCue,
      prepSec: PREP_SEC,
    });

  const finish = (doneRemates) => {
    r.doneRemates = doneRemates;
    r.durationSec = totalDuration;
    r.roundsCompleted = r.rounds;
    state.engine = null;
    location.hash = "#/log";
  };

  const afterMain = () => {
    // El motor no emite un tick final: dejar el dial en 0 y el anillo vacío.
    setDial(0);
    setRing(0, state.engine.step);
    totalDuration += state.engine.durationSec();
    updatePP();
    const rem = remateExercises(day);
    const str = r.stretch ? stretchExercises(day) : [];
    // Lo que va tras el bloque principal (remate elegido + estiramientos) va en
    // otro motor. Sin nada más, directo al registro.
    const runTail = (exs) => {
      if (!exs.length && !str.length) {
        if (tailAhead) state.engine.announceDone(); // el motor principal dijo "Bloque terminado"
        return finish(exs);
      }
      const tSteps = annotate(buildSteps(day, [], { rounds: 0, remates: exs, stretches: str }), r.targets);
      // Su primer descanso no ve el último ejercicio del bloque principal: se le
      // enlaza a mano para apuntar sus reps (la última ronda).
      const lastWork = steps.findLast((x) => x.kind === "work" && x.exerciseId != null);
      if (tSteps[0]?.kind === "rest" && lastWork)
        tSteps[0].prevWork = { exerciseId: lastWork.exerciseId, round: lastWork.round || 1, name: lastWork.name };
      $("overlay").classList.remove("show");
      $("overlay").innerHTML = "";
      state.engine = makeEngine(tSteps, () => {
        totalDuration += state.engine.durationSec();
        finish(exs);
      });
      state.engine.start(); // el audio ya está desbloqueado desde el Iniciar
      updatePP();
    };
    if (!rem.length) return runTail([]);
    const ov = $("overlay");
    ov.classList.add("show");
    ov.innerHTML = `
      <div class="card col gap">
        <strong>¿Hacer remate?</strong>
        ${rem
          .map(
            (e) =>
              switchRow(`${esc(e.name)} · ${e.work_sec ?? day.work_sec}s`, `value="${e.id}" ${e.is_optional ? "" : "checked"}`)
          )
          .join("")}
        <button class="primary" id="remgo">Continuar</button>
      </div>`;
    $("remgo").onclick = () => {
      const chosen = [...ov.querySelectorAll("input:checked")].map((c) => +c.value);
      runTail(rem.filter((e) => chosen.includes(e.id)));
    };
  };

  // Si queda remate o estiramientos, al acabar el bloque principal no se anuncia "Entreno terminado".
  const tailAhead = remateExercises(day).length > 0 || (r.stretch && stretchExercises(day).length > 0);
  state.engine = makeEngine(steps, afterMain, !tailAhead);
  paint(steps[0], 0);
  paintMute();

  $("pp").onclick = () => {
    state.engine?.toggle();
    updatePP();
  };
  // Mapa muscular ampliado: tocar el mini mapa; cerrar con ✕, Escape, fuera o deslizando.
  $("mapbtn").onclick = openMap;
  // Reps en el descanso: cada cambio queda apuntado para el registro final.
  bindSteppers($("restlog"));
  $("rlInput").addEventListener("input", (e) => {
    const inp = e.target;
    const ex = +inp.dataset.ex;
    const round = +inp.dataset.round;
    if (!ex) return;
    r.roundLog ||= {};
    r.roundLog[ex] ||= {};
    r.roundLog[ex][round] = inp.value === "" ? null : Math.min(999, Math.max(0, Math.round(+inp.value)));
    inp.classList.remove("ghosted");
    markSaved(false); // cambiado: falta confirmar (aunque ya queda apuntado)
  });
  // "Guardar": confirma lo que hay (también el número sugerido) y cierra el teclado.
  $("rlSave").onclick = () => {
    const inp = $("rlInput");
    if (inp.value === "") return inp.focus();
    inp.dispatchEvent(new Event("input"));
    inp.blur();
    markSaved(true);
    replay($("rlSave"), "pop");
  };
  // Tocar el número sugerido (gris) lo da por bueno sin tener que cambiarlo.
  $("rlInput").addEventListener("focus", (e) => {
    if (e.target.classList.contains("ghosted") && e.target.value !== "") e.target.dispatchEvent(new Event("input"));
  });
  // Las instrucciones van recortadas: tocarlas abre la hoja con el texto entero.
  $("exinfo").onclick = openMap;
  $("exinfo").onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openMap();
    }
  };
  $("mapClose").onclick = () => $("mapzoom").close();
  $("mapzoom").addEventListener("click", (e) => {
    const d = $("mapzoom");
    if (e.target !== d) return;
    const rc = d.getBoundingClientRect();
    if (e.clientX < rc.left || e.clientX > rc.right || e.clientY < rc.top || e.clientY > rc.bottom) d.close();
  });
  {
    let y0 = null;
    const d = $("mapzoom");
    for (const el of [d.querySelector(".sheet-head"), d.querySelector(".sheet-grip")]) {
      el.addEventListener("touchstart", (e) => (y0 = e.touches[0].clientY), { passive: true });
      el.addEventListener("touchmove", (e) => {
        if (y0 != null) d.style.transform = `translateY(${Math.max(0, e.touches[0].clientY - y0)}px)`;
      }, { passive: true });
      el.addEventListener("touchend", (e) => {
        const dy = y0 == null ? 0 : e.changedTouches[0].clientY - y0;
        y0 = null;
        d.style.transform = "";
        if (dy > 90) d.close();
      });
      el.addEventListener("touchcancel", () => ((y0 = null), (d.style.transform = "")));
    }
  }
  $("mute").onclick = () => {
    muted = !muted;
    writeMuted(storage(), muted);
    state.engine?.setMuted(muted);
    paintMute();
  };
  $("skip").onclick = () => { state.engine?.skip(); updatePP(); };
  $("back").onclick = () => { state.engine?.back(); updatePP(); };
  $("exit").onclick = () => {
    if (confirm("¿Salir sin guardar el entreno?")) {
      state.engine?.stop();
      state.engine = null;
      state.run = null;
      location.hash = "#/";
    }
  };
}

// ------------------------------- log -----------------------------------
/** Confeti (referencia 21st.dev: Confetti). Canvas efímero; nada con reduced-motion. */
function confetti(colors) {
  if (reduceMotion()) return;
  const c = document.createElement("canvas");
  c.className = "confetti";
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = innerWidth * dpr;
  c.height = innerHeight * dpr;
  document.body.appendChild(c);
  const ctx = c.getContext("2d");
  ctx.scale(dpr, dpr);
  const parts = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 80,
    y: innerHeight * 0.32,
    vx: (Math.random() - 0.5) * 11,
    vy: -Math.random() * 13 - 4,
    w: 5 + Math.random() * 6,
    h: 8 + Math.random() * 8,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  let last = t0;
  const frame = (t) => {
    const k = (t - t0) / 1800;
    const f = Math.min(3, (t - last) / 16.67); // física por tiempo: igual a 60 y a 120 Hz
    last = t;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.32 * f;
      p.vx *= Math.pow(0.99, f);
      p.x += p.vx * f;
      p.y += p.vy * f;
      p.r += p.vr * f;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - k * k);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)));
      ctx.restore();
    }
    if (k < 1) requestAnimationFrame(frame);
    else c.remove();
  };
  requestAnimationFrame(frame);
}

/** Stepper de reps (referencia 21st.dev: Quantity Stepper): −/+ con pulsación
 *  mantenida que acelera; el número también se puede escribir. */
const repStep = (name, round, value, hint = null) => `
    <div class="rep-step">
      <button type="button" class="glass round" data-step="-1" aria-label="Una rep menos, ${esc(name)} ronda ${round}">${ICON.minus}</button>
      <input class="reps" type="number" inputmode="numeric" min="0" max="999"
             value="${value ?? ""}" placeholder="${hint ?? "—"}" aria-label="Reps de ${esc(name)}, ronda ${round}${hint != null ? `, la última vez ${hint}` : ""}" />
      <button type="button" class="glass round" data-step="1" aria-label="Una rep más, ${esc(name)} ronda ${round}">${ICON.plus}</button>
    </div>`;

/** Selector de kg: solo los pesos que se pueden montar con los discos. */
const kgSelect = (e, round, kg) => {
  const opts = loadOptions(e.equipment);
  // Un kg antiguo que ya no se puede montar no se pierde: se ofrece igualmente.
  if (kg != null && !opts.includes(kg)) opts.push(kg), opts.sort((a, b) => a - b);
  return `<select class="kg" aria-label="Kg de ${esc(e.name)}, ronda ${round}">
    <option value="" ${kg == null ? "selected" : ""}>— kg</option>
    ${opts.map((v) => `<option value="${v}" ${kg === v ? "selected" : ""}>${kgLabel(v)}</option>`).join("")}
  </select>`;
};

/** Tarjeta de un ejercicio en el registro: una fila por ronda (kg + reps). */
const exerciseLog = (e, dayId, rounds, target, last, done) => {
  const w = weighted(e);
  const kg0 = target?.kg ?? last?.kg ?? null;
  // Valor = solo lo apuntado hoy (en el descanso). Lo de la última vez es una pista
  // en gris (placeholder): si no se confirma, NO se guarda como si fuera de hoy.
  const today = (k) => (done && k in done ? done[k] : null);
  const hint = (k) => last?.rounds?.find((x) => x.round === k)?.reps ?? null;
  const rows = Array.from({ length: rounds }, (_, i) => i + 1)
    .map(
      (k) => `<div class="round-row" data-round="${k}">
        <span class="rn">R${k}</span>
        ${repStep(e.name, k, today(k), hint(k))}
        ${w ? kgSelect(e, k, kg0) : ""}
      </div>`
    )
    .join("");
  const tags = [
    target?.rep_min ? `objetivo ${target.rep_min}–${target.rep_max}` : "",
    last ? `última vez: ${w ? kgLabel(last.kg) + " × " : ""}${last.rounds.map((x) => x.reps ?? "—").join("/")}` : "",
  ].filter(Boolean);
  return `<div class="card rep-card" style="--day: var(--d${dayId})" data-ex="${e.id}" data-eq="${e.equipment || ""}">
    <div class="rep-info">
      <strong>${esc(e.name)}</strong>
      <span class="muted small">${tags.join(" · ") || esc(e.muscle_primary || "")}</span>
      ${w ? `<span class="small plates" aria-live="polite">${kg0 != null ? platesText(kg0, e.equipment) : ""}</span>` : ""}
    </div>
    <div class="rounds">${rows}</div>
  </div>`;
};

/** kg: al cambiar una ronda, las siguientes que tenían el mismo valor lo copian. */
function bindKg(root) {
  root.querySelectorAll(".rep-card").forEach((card) => {
    const sels = [...card.querySelectorAll("select.kg")];
    let prev = sels.map((x) => x.value);
    sels.forEach((sel, i) => {
      sel.onchange = () => {
        for (let j = i + 1; j < sels.length; j++) if (sels[j].value === prev[i]) sels[j].value = sel.value;
        prev = sels.map((x) => x.value);
        const p = card.querySelector(".plates");
        if (p && i === 0) p.textContent = sel.value === "" ? "" : platesText(+sel.value, card.dataset.eq);
      };
    });
  });
}

function bindSteppers(root) {
  root.querySelectorAll(".rep-step").forEach((box) => {
    const input = box.querySelector("input");
    let timer = null;
    let n = 0;
    const bump = (d) => {
      // Vacío con pista (la última vez): − / + parten de ella.
      const base = input.value === "" && /^\d+$/.test(input.placeholder) ? input.placeholder : input.value;
      const v = stepValue(base, d);
      if (String(v) === input.value) return;
      input.value = String(v);
      input.dispatchEvent(new Event("input", { bubbles: true })); // avisa a quien escuche (descanso)
      replay(input, "tick");
    };
    let held = false;
    let pressed = false;
    const stop = () => {
      clearTimeout(timer);
      timer = null;
      pressed = false;
    };
    box.querySelectorAll("[data-step]").forEach((b) => {
      const d = +b.dataset.step;
      // El toque cuenta al soltar: si el dedo empieza un scroll llega pointercancel
      // y no se cambia nada. Mantener pulsado repite y acelera desde los 450 ms.
      b.addEventListener("pointerdown", (ev) => {
        ev.preventDefault(); // no roba el foco ni cierra el teclado
        stop(); // un segundo dedo no deja bucles huérfanos
        pressed = true;
        held = false;
        n = 0;
        const rep = () => {
          if (!input.isConnected) return stop(); // la vista ya no está
          held = true;
          bump(d);
          timer = setTimeout(rep, holdInterval(++n));
        };
        timer = setTimeout(rep, 450);
      });
      b.addEventListener("pointerup", () => {
        if (pressed && !held) bump(d);
        stop();
      });
      for (const evt of ["pointerleave", "pointercancel"]) b.addEventListener(evt, stop);
      // Teclado y VoiceOver activan con click sin puntero (detail === 0).
      b.addEventListener("click", (ev) => {
        if (ev.detail === 0) bump(d);
      });
      b.addEventListener("contextmenu", (ev) => ev.preventDefault());
    });
  });
}

async function viewLog() {
  const r = state.run;
  if (!r) return (location.hash = "#/");
  const { day } = r;
  const list = [...mainExercises(day), ...(r.doneRemates || [])];
  let last = {};
  let records = null;
  [last, records] = await Promise.all([
    api.lastLogs(day.id).catch(() => ({})),
    api.records(day.id).catch(() => null), // antes de guardar: para detectar récords
  ]);
  const targets = r.targets || targetsFor(day.exercises, last);
  const fromTimer = r.source === "timer";
  const week = weekProgress(
    [{ date: r.date, day_id: day.id }, ...api.pendingSessions(), ...(readRecent() || [])],
    todayISO()
  );
  const tile = (label, value) => `<div class="sum-tile"><span class="kpi-label">${label}</span><b>${value}</b></div>`;

  h(`
    <div class="pane log" style="--day: var(--d${day.id})">
      ${topBar(fromTimer ? "Entreno terminado" : `Registrar — Día ${day.id}`, null)}
      ${
        fromTimer
          ? `<section class="card done-hero">
        <div class="done-badge" aria-hidden="true">${ICON.check}</div>
        <h2>¡Entreno completado!</h2>
        <span class="muted">Día ${day.id} — ${esc(day.name)}${r.isDeload ? " · deload" : ""}</span>
        <div class="sum-grid">
          ${tile("Duración", r.durationSec ? fmt(r.durationSec) : "—")}
          ${tile("Rondas", `${r.roundsCompleted ?? r.rounds}/${r.rounds}`)}
          ${tile("Ejercicios", list.length)}
          ${tile("Semana", `${week.done}/${week.goal}`)}
        </div>
      </section>`
          : `<div class="muted small">${fmtDayLong(r.date)} · ${r.rounds} rondas${r.isDeload ? " · deload" : ""}</div>`
      }
      <h3 class="section-title">Apunta kg y reps <span class="muted">· por ronda</span></h3>
      <div class="col gap">
        ${
          list.length
            ? list
                .map((e) =>
                  exerciseLog(
                    e,
                    day.id,
                    e.block === "remate" ? e.rounds || 1 : r.roundsCompleted ?? r.rounds,
                    targets[e.id],
                    (last[e.id] || last[String(e.id)] || [])[0],
                    r.roundLog?.[e.id]
                  )
                )
                .join("")
            : `<div class="muted">Sin ejercicios en este día.</div>`
        }
      </div>
      <button class="primary big-btn mt" id="save">Guardar sesión</button>
      <button class="ghost small" id="skip">Guardar sin apuntar nada</button>
    </div>`);
  bindSteppers(app);
  bindKg(app);
  if (fromTimer) confetti([cssVar(`--d${day.id}`), cssVar("--c-work"), cssVar("--c-rest"), cssVar("--c-warm"), "#ffffff"]);

  const save = async (withReps) => {
    // Evita un doble toque que enviaría (o encolaría) la sesión dos veces.
    for (const id of ["save", "skip"]) document.getElementById(id).disabled = true;
    const logs = [];
    if (withReps)
      for (const card of document.querySelectorAll(".rep-card")) {
        for (const row of card.querySelectorAll(".round-row")) {
          const reps = row.querySelector("input.reps").value;
          const kg = row.querySelector("select.kg")?.value ?? "";
          if (reps === "" && kg === "") continue; // nada apuntado en esta ronda
          logs.push({
            exercise_id: +card.dataset.ex,
            round_number: +row.dataset.round,
            reps: reps === "" ? null : Math.min(999, Math.max(0, Math.round(+reps))),
            weight_kg: kg === "" ? null : +kg,
          });
        }
      }
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
    delete state.targets[day.id]; // el próximo "hoy toca" ya cuenta esta sesión
    if (!res.ok) {
      for (const id of ["save", "skip"]) document.getElementById(id).disabled = false;
      return toast("No se pudo guardar: revisa los datos");
    }
    const prs = records ? detectPRs(records, logs) : [];
    if (prs.length) return celebratePRs(prs, list, day.id, res.queued);
    toast(res.queued ? "Guardado local — se subirá al reconectar" : "Sesión guardada");
    location.hash = "#/";
  };
  document.getElementById("save").onclick = () => save(true);
  document.getElementById("skip").onclick = () => save(false);
}

/** Récords personales: tarjeta de celebración antes de volver al inicio. */
function celebratePRs(prs, exercises, dayId, queued) {
  const nameOf = (id) => exercises.find((e) => e.id === id)?.name || "Ejercicio";
  const line = (p) =>
    p.type === "kg"
      ? `<li><strong>${esc(nameOf(p.exerciseId))}</strong><span>nuevo peso máximo: <b>${kgLabel(p.kg)}</b> (antes ${kgLabel(p.prev)})</span></li>`
      : `<li><strong>${esc(nameOf(p.exerciseId))}</strong><span><b>${p.reps} reps</b>${p.kg != null ? ` con ${kgLabel(p.kg)}` : ""} (antes ${p.prev})</span></li>`;
  const ov = document.createElement("div");
  ov.className = "overlay show pr-ov";
  ov.setAttribute("role", "dialog");
  ov.setAttribute("aria-modal", "true");
  ov.setAttribute("aria-labelledby", "prTitle");
  ov.innerHTML = `<div class="card pr-card" style="--day: var(--d${dayId})">
    <div class="pr-badge" aria-hidden="true">${ICON.trophy}</div>
    <h2 id="prTitle">${prs.length > 1 ? `¡${prs.length} récords nuevos!` : "¡Nuevo récord!"}</h2>
    <ul class="pr-list">${prs.map(line).join("")}</ul>
    ${queued ? `<p class="muted small">Guardado en el móvil: se subirá al reconectar.</p>` : ""}
    <button class="primary big-btn" id="prOk">¡Vamos!</button>
  </div>`;
  const pane = app.querySelector(".pane");
  for (const el of pane.children) el.inert = true; // el registro de detrás no recibe foco
  pane.appendChild(ov);
  confetti([cssVar(`--d${dayId}`), cssVar("--c-work"), cssVar("--c-warm"), "#ffffff"]);
  const ok = ov.querySelector("#prOk");
  ok.focus();
  ok.onclick = () => (location.hash = "#/");
}

// ------------------------------- manual --------------------------------
function viewManual() {
  let dayId = 1;
  let rounds = dayById(1)?.rounds || 3;
  const days = state.boot.days.filter((d) => d.id >= 1);
  h(`
    <div class="pane">
      ${topBar("Sesión manual")}
      <h3 class="section-title">¿Qué entrenaste?</h3>
      <div class="day-pick" role="radiogroup" aria-label="Día">
        ${days
          .map(
            (d) => `<label class="card pick" style="--day: var(--d${d.id})">
            <input type="radio" name="day" value="${d.id}" ${d.id === dayId ? "checked" : ""} />
            <span class="dotc"></span><span><strong>Día ${d.id}</strong><br /><span class="muted small">${esc(d.name)}</span></span>
          </label>`
          )
          .join("")}
      </div>
      <div class="card col gap">
        <label for="date">Fecha</label><input id="date" type="date" value="${todayISO()}" max="${todayISO()}" />
        <label>Rondas</label>
        <div class="stepper">
          <button id="minus" class="glass" aria-label="Menos rondas">${ICON.minus}</button>
          <span class="big" id="rounds" aria-live="polite">${rounds}</span>
          <button id="plus" class="glass" aria-label="Más rondas">${ICON.plus}</button>
        </div>
        ${switchRow("Semana de deload", 'id="deload"')}
      </div>
      <button class="primary big-btn" id="go">Continuar a registro</button>
    </div>`);
  const paintRounds = () => (document.getElementById("rounds").textContent = rounds);
  document.getElementById("minus").onclick = () => ((rounds = Math.max(1, rounds - 1)), paintRounds());
  document.getElementById("plus").onclick = () => ((rounds = Math.min(6, rounds + 1)), paintRounds());
  app.querySelectorAll('input[name="day"]').forEach((el) => {
    el.onchange = () => {
      dayId = +el.value;
      rounds = dayById(dayId)?.rounds || rounds;
      paintRounds();
    };
  });
  document.getElementById("go").onclick = () => {
    const day = dayById(dayId);
    state.run = {
      day,
      rounds,
      isDeload: document.getElementById("deload").checked,
      date: document.getElementById("date").value,
      source: "manual",
      roundsCompleted: rounds,
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
  const lastOf = (k) => [...rows].reverse().find((m) => m[k] != null);
  const ago = (iso) => {
    const d = Math.round((Date.parse(todayISO()) - Date.parse(String(iso).slice(0, 10))) / 864e5);
    return d <= 0 ? "hoy" : d === 1 ? "ayer" : `hace ${d} días`;
  };
  const field = (id, label, unit, key, color) => {
    const last = lastOf(key);
    const series = rows.filter((m) => m[key] != null).slice(-10).map((m) => +m[key]);
    return `<div class="card meas">
      <label for="${id}" class="kpi-label">${label}</label>
      <div class="meas-input"><input id="${id}" type="number" inputmode="decimal" step="0.1" placeholder="${last ? nf(last[key]) : "—"}" /><span>${unit}</span></div>
      <span class="muted small">${last ? `último: ${nf(last[key])} ${unit} · ${ago(last.date)}` : "sin registros"}</span>
      ${spark(series, color, 120, 26)}
    </div>`;
  };
  const recent = rows
    .slice(-8)
    .reverse()
    .map(
      (m) =>
        `<tr><td>${fmtDayLong(String(m.date).slice(0, 10))}</td><td>${m.weight_kg != null ? nf(m.weight_kg) : "—"}</td><td>${
          m.waist_cm != null ? nf(m.waist_cm) : "—"
        }</td><td>${m.is_standard_conditions ? "" : `<span title="Fuera de condiciones estándar">▲</span>`}</td></tr>`
    )
    .join("");
  h(`
    <div class="pane">
      ${topBar("Peso", null)}
      <div class="meas-grid">
        ${field("w", "Peso", "kg", "weight_kg", cssVar("--c-rest"))}
        ${field("waist", "Cintura", "cm", "waist_cm", cssVar("--c-waist"))}
      </div>
      <div class="card col gap">
        <label for="date">Fecha</label><input id="date" type="date" value="${todayISO()}" max="${todayISO()}" />
        ${switchRow("Condiciones estándar", 'id="std" checked')}
        <div class="muted small">${esc(reminder)}</div>
        <label for="note">Nota</label><input id="note" type="text" placeholder="opcional" />
      </div>
      <button class="primary big-btn" id="go">Guardar</button>
      <h3 class="section-title">Últimos registros</h3>
      <div class="card table-card"><table><thead><tr><th>Fecha</th><th>Peso</th><th>Cintura</th><th></th></tr></thead>
        <tbody>${recent || `<tr><td colspan="4" class="muted">Sin registros</td></tr>`}</tbody></table></div>
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
// Línea de tiempo por semanas (referencia 21st.dev: Timeline agrupado por día).
async function viewHistory(limit = 50) {
  let s = [];
  try { s = await api.sessions(limit + 1); } catch (_) {} // +1: saber si hay más
  const hasMore = s.length > limit;
  s = s.slice(0, limit);
  const weeks = groupByWeek(s);
  const weekTitle = (mon) => (mon === mondayISO(todayISO()) ? "Esta semana" : `Semana del ${fmtDay(mon)}`);
  h(`
    <div class="pane history">
      ${topBar("Historial", null)}
      <a class="btn" href="#/manual">${ICON.plus}Añadir sesión manual</a>
      ${
        weeks.length
          ? weeks
              .map(
                (w) => `<section class="tl-week">
          <header class="tl-head"><span>${weekTitle(w.monday)}</span><span class="pill ${w.days >= 4 ? "ok" : ""}">${w.days}/4 días</span></header>
          <ol class="tl">
            ${w.items
              .map(
                (x) => `<li class="tl-item" style="--day: var(--d${x.day_id})">
              <span class="tl-dot" aria-hidden="true"></span>
              <div class="card tl-card">
                <div class="row between"><strong>Día ${x.day_id} — ${esc(x.day_name)}</strong>${x.is_deload ? '<span class="pill">deload</span>' : ""}</div>
                <span class="muted small">${fmtDayLong(String(x.date).slice(0, 10))} · ${x.rounds_completed ?? "?"} rondas${
                  x.duration_sec ? " · " + fmt(x.duration_sec) : ""
                } · ${x.source === "manual" ? "manual" : "con timer"}</span>
              </div>
            </li>`
              )
              .join("")}
          </ol>
        </section>`
              )
              .join("")
          : `<div class="card muted">Sin sesiones todavía. ¡La primera te espera!</div>`
      }
      ${hasMore ? `<button class="btn" id="more">Ver más</button>` : ""}
      <button class="ghost small logout" id="out">${ICON.logout}Cerrar sesión</button>
    </div>`);
  const more = document.getElementById("more");
  if (more) more.onclick = () => viewHistory(limit + 50);
  document.getElementById("out").onclick = logout;
}

// ------------------------------ dashboard -------------------------------
const DAY_NAMES = { 1: "Empuje", 2: "HIIT + core", 3: "Tracción", 4: "Piernas + core", 5: "Libre" };
const RANGE_KEY = "entreno.dashRange";
const RANGES = [
  ["1m", "1M"],
  ["3m", "3M"],
  ["all", "Todo"],
];
const readRange = () => {
  try {
    return localStorage.getItem(RANGE_KEY) || "3m";
  } catch (_) {
    return "3m";
  }
};
const nf = (v, dec = 1) => Number(v).toLocaleString("es-ES", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const signed = (v, dec = 1) => (v > 0 ? "+" : v < 0 ? "−" : "±") + nf(Math.abs(v), dec);
const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const cssVar = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const fmtDay = (iso) =>
  new Date(iso + "T12:00:00").toLocaleDateString("es-ES", { day: "numeric", month: "short" }).replace(".", "");
const fmtDayLong = (iso) =>
  new Date(iso + "T12:00:00").toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" }).replace(/\./g, "");

/** Mini gráfica SVG (sin Chart.js: funciona sin red). */
const spark = (vals, color, w = 96, h = 28, cls = "spark") => {
  const d = sparkPath(vals, w, h, 3);
  if (!d) return "";
  const dot = d.split(" ").at(-1).slice(1).split(",");
  return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" aria-hidden="true" style="--c:${color}">
    <path d="${d}" /><circle cx="${dot[0]}" cy="${dot[1]}" r="2.6" /></svg>`;
};

// Tema de Chart.js desde los tokens de la app.
function chartTheme() {
  return { fg: cssVar("--fg"), muted: cssVar("--muted"), card: cssVar("--card"), line: "#ffffff12", goal: cssVar("--c-work") };
}
const alpha = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, "0");

// Crosshair vertical en el punto activo del tooltip.
const crosshair = {
  id: "crosshair",
  afterDatasetsDraw(chart) {
    const a = chart.tooltip?.getActiveElements?.();
    if (!a?.length) return;
    const { ctx, chartArea } = chart;
    const x = a[0].element.x;
    ctx.save();
    ctx.strokeStyle = "#ffffff40";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.stroke();
    ctx.restore();
  },
};

function baseOpts({ big = false, unit = "" } = {}) {
  const t = chartTheme();
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: reduceMotion() ? false : { duration: 700, easing: "easeOutQuart" },
    interaction: { mode: "index", intersect: false },
    layout: { padding: { top: 6, right: 4 } },
    plugins: {
      legend: { display: false }, // leyenda propia en HTML (texto con tokens)
      tooltip: {
        enabled: big || matchMedia("(hover: hover)").matches,
        backgroundColor: alpha(t.card.length === 7 ? t.card : "#1a1d24", 0.94),
        borderColor: "#ffffff26",
        borderWidth: 1,
        titleColor: t.muted,
        bodyColor: t.fg,
        padding: 10,
        cornerRadius: 10,
        displayColors: false,
        callbacks: {
          title: (items) => fmtDayLong(items[0].label),
          label: (it) => (it.raw == null ? null : `${it.dataset.label}: ${nf(it.raw)}${unit}`),
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { color: t.line },
        ticks: { color: t.muted, maxRotation: 0, autoSkip: true, maxTicksLimit: big ? 8 : 5, callback(v) { return fmtDay(this.getLabelForValue(v)); } },
      },
      y: {
        grid: { color: t.line },
        border: { display: false },
        ticks: { color: t.muted, maxTicksLimit: big ? 7 : 4, callback: (v) => nf(v) },
      },
    },
  };
}

/** Peso/cintura: media móvil con área degradada + registros + objetivo. */
function measureChart(canvas, pts, { color, goal = null, big = false, unit = "" }) {
  const labels = pts.map((p) => p.date);
  const datasets = [
    {
      label: "Media 7",
      data: pts.map((p) => p.avg),
      borderColor: color,
      borderWidth: big ? 2.5 : 2,
      tension: 0.35,
      pointRadius: 0,
      pointHoverRadius: 5,
      pointHoverBackgroundColor: color,
      fill: "origin",
      backgroundColor: (ctx) => {
        const { chartArea, ctx: c } = ctx.chart;
        if (!chartArea) return alpha(color, 0.15);
        const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
        g.addColorStop(0, alpha(color, 0.32));
        g.addColorStop(1, alpha(color, 0));
        return g;
      },
    },
    {
      label: "Registro",
      data: pts.map((p) => p.y),
      showLine: false,
      borderColor: "#ffffff70",
      backgroundColor: "#ffffff70",
      pointRadius: pts.map((p) => (p.std === false ? (big ? 5 : 4) : big ? 3 : 2)),
      pointStyle: pts.map((p) => (p.std === false ? "triangle" : "circle")),
      pointHoverRadius: 5,
    },
  ];
  if (goal != null)
    datasets.push({
      label: "Objetivo",
      data: labels.map(() => goal),
      borderColor: alpha(chartTheme().goal, 0.8),
      borderDash: [6, 5],
      borderWidth: 1.5,
      pointRadius: 0,
      pointHoverRadius: 0,
    });
  const opts = baseOpts({ big, unit });
  // Que la escala no se aplaste: el objetivo entra solo si está cerca.
  if (goal != null) {
    const vals = pts.flatMap((p) => [p.y, p.avg]);
    opts.scales.y.suggestedMin = Math.min(...vals, goal) - 0.5;
    opts.scales.y.suggestedMax = Math.max(...vals) + 0.5;
  }
  return new Chart(canvas, { type: "line", data: { labels, datasets }, options: opts, plugins: [crosshair] });
}

/** Fuerza: reps/40 s de un ejercicio, deload como triángulo. */
function strengthChart(canvas, ex, color, big) {
  const labels = ex.points.map((p) => p.date);
  return new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Reps / 40 s",
          data: ex.points.map((p) => p.y),
          borderColor: color,
          backgroundColor: color,
          borderWidth: 2.5,
          tension: 0.3,
          pointRadius: ex.points.map((p) => (p.deload ? 6 : 3.5)),
          pointStyle: ex.points.map((p) => (p.deload ? "triangle" : "circle")),
          fill: false,
        },
      ],
    },
    options: baseOpts({ big }),
    plugins: [crosshair],
  });
}

/** Número que cuenta hacia su valor (se salta con reduced-motion). */
function countUp(root) {
  root.querySelectorAll("[data-count]").forEach((el) => {
    const to = +el.dataset.count;
    const dec = +(el.dataset.dec || 0);
    if (reduceMotion() || !isFinite(to)) return;
    const t0 = performance.now();
    const from = dec ? to * 0.97 : 0; // los pesos no arrancan en 0: solo "rodar" al final
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 700);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = nf(from + (to - from) * e, dec);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

async function viewDashboard() {
  let d;
  try {
    d = await api.dashboard();
  } catch (_) {
    return;
  }
  const hasChart = typeof window.Chart === "function";
  const today = todayISO();
  let range = readRange();
  const BLUE = cssVar("--c-rest");
  const AQUA = cssVar("--c-waist");

  const weightAll = withAvg(d.measurements.filter((m) => m.weight_kg != null).map((m) => ({ date: m.date, y: +m.weight_kg, std: m.is_standard_conditions })));
  const waistAll = withAvg(d.measurements.filter((m) => m.waist_cm != null).map((m) => ({ date: m.date, y: +m.waist_cm, std: m.is_standard_conditions })));
  const goal = d.goal_weight_kg;
  const wNow = weightAll.at(-1)?.avg ?? null;
  const prog = goalProgress(weightAll[0]?.avg ?? null, wNow, goal);
  const wDelta = deltaOver(weightAll, today, 30);
  const cDelta = deltaOver(waistAll, today, 30);
  const months = monthCounts(d.sessions, today);
  const wk = weekProgress(d.sessions, today);
  const best = Math.max(bestWeekStreak(d.sessions), wk.streak);
  const weeks = heatWeeks(d.sessions, today, 16);
  const strength = strengthByDay(d.strength);

  const kpi = ({ label, value, dec, unit, sub, sparkHTML, extra = "" }) => `
    <div class="card kpi">
      <span class="kpi-label">${label}</span>
      <span class="kpi-value">${value == null ? "—" : `<b data-count="${value}" data-dec="${dec}">${nf(value, dec)}</b>`}<small>${unit}</small></span>
      <span class="kpi-sub">${sub}</span>
      ${sparkHTML}${extra}
    </div>`;
  const deltaTxt = (v, unit) => (v == null ? "sin datos de hace 30 días" : `${signed(v)} ${unit} en 30 días`);
  const weekBars = weeks.slice(-8).map((w) => w.count);

  const heatHTML = () => {
    let lastMonth = "";
    const cols = weeks
      .map((w) => {
        const m = new Date(w.monday + "T12:00:00").toLocaleDateString("es-ES", { month: "short" }).replace(".", "");
        const mLabel = m !== lastMonth ? m : "";
        lastMonth = m;
        const cells = w.days
          .map((c) => {
            const cls = ["hc", c.dayId ? "on" : "", c.deload ? "dl" : "", c.future ? "fut" : "", c.today ? "now" : ""].join(" ");
            const info = c.dayId ? `${fmtDayLong(c.date)} · Día ${c.dayId} ${DAY_NAMES[c.dayId] || ""}${c.deload ? " · deload" : ""}` : `${fmtDayLong(c.date)} · sin entreno`;
            return `<span class="${cls}" ${c.dayId ? `style="--day: var(--d${c.dayId})"` : ""} data-info="${esc(info)}" title="${esc(info)}"></span>`;
          })
          .join("");
        return `<div class="hcol"><span class="hm">${mLabel}</span>${cells}<span class="hn ${w.count >= 4 ? "ok" : ""}">${w.count || ""}</span></div>`;
      })
      .join("");
    return `<div class="heat2" role="img" aria-label="Calendario de entrenos de las últimas 16 semanas">
      <div class="hdays"><span></span><span>L</span><span></span><span>X</span><span></span><span>V</span><span></span><span>D</span><span></span></div>
      ${cols}</div>`;
  };

  h(`
    <div class="pane dash">
      ${topBar("Progreso", null)}
      <div class="chips" role="group" aria-label="Rango de fechas">
        ${RANGES.map(([k, t]) => `<button class="chip ${k === range ? "on" : ""}" data-range="${k}" aria-pressed="${k === range}">${t}</button>`).join("")}
      </div>
      <div class="kpis">
        ${kpi({ label: "Peso", value: wNow, dec: 1, unit: " kg", sub: deltaTxt(wDelta, "kg"), sparkHTML: spark(weightAll.slice(-30).map((p) => p.avg), BLUE) })}
        ${kpi({ label: "Cintura", value: waistAll.at(-1)?.avg ?? null, dec: 1, unit: " cm", sub: deltaTxt(cDelta, "cm"), sparkHTML: spark(waistAll.slice(-30).map((p) => p.avg), AQUA) })}
        ${kpi({
          label: "Entrenos del mes",
          value: months.thisMonth,
          dec: 0,
          unit: "",
          sub: `${months.lastMonth} el mes pasado`,
          sparkHTML: `<div class="bars" aria-hidden="true">${weekBars.map((n) => `<i class="${n >= 4 ? "ok" : ""}" style="height:${Math.max(8, (Math.min(n, 7) / 7) * 100)}%"></i>`).join("")}</div>`,
        })}
        ${kpi({
          label: "Racha",
          value: wk.streak,
          dec: 0,
          unit: wk.streak === 1 ? " semana" : " semanas",
          sub: `mejor: ${best} · esta semana ${wk.done}/${wk.goal}`,
          sparkHTML: `<div class="dots" aria-hidden="true">${weeks.slice(-8).map((w) => `<i class="${w.count >= 4 ? "ok" : ""}"></i>`).join("")}</div>`,
        })}
      </div>

      <section class="card hero expandable" data-zoom="weight" tabindex="0" role="button" aria-label="Ampliar la gráfica de peso">
        <div class="row between hero-head">
          <div class="col">
            <span class="kpi-label">Peso · camino al objetivo de ${nf(goal)} kg</span>
            <span class="hero-num">${
              !prog ? "—" : prog.remaining ? `${nf(prog.remaining)}<small> kg por bajar</small>` : `<small>¡Objetivo alcanzado!</small>`
            }</span>
          </div>
          <span class="glass round zoom-ico" aria-hidden="true">${ICON.expand}</span>
        </div>
        <div class="legend small"><span class="lg"><i class="lg-line" style="--c:${BLUE}"></i>Media</span><span class="lg"><i class="lg-dot"></i>Registro</span><span class="lg"><i class="lg-tri"></i>Fuera de condiciones</span><span class="lg"><i class="lg-dash"></i>Objetivo</span></div>
        <div class="cw"><canvas id="cWeight"></canvas></div><p class="muted small cw-msg" hidden></p>
        ${
          prog
            ? `<div class="goal">
          <div class="row between small"><span><b>${prog.pct} %</b> del camino</span><span class="muted">de ${nf(weightAll[0].avg)} a ${nf(goal)} kg · hoy ${nf(wNow)} kg</span></div>
          <div class="goalbar" role="progressbar" aria-valuenow="${prog.pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${prog.pct}%"></i></div>
        </div>`
            : ""
        }
      </section>

      <section class="card waist expandable" data-zoom="waist" tabindex="0" role="button" aria-label="Ampliar la gráfica de cintura">
        <div class="row between">
          <span class="kpi-label">Cintura · media 7 registros</span>
          <span class="glass round zoom-ico" aria-hidden="true">${ICON.expand}</span>
        </div>
        <div class="cw sm"><canvas id="cWaist"></canvas></div><p class="muted small cw-msg" hidden></p>
      </section>

      <section class="card sec-consistency">
        <div class="row between wrap">
          <h3>Constancia</h3>
          <span class="muted small">Racha <b>${wk.streak}</b> · mejor <b>${best}</b> · esta semana <b>${wk.done}/${wk.goal}</b></span>
        </div>
        ${heatHTML()}
        <div class="legend small">
          ${[1, 2, 3, 4, 5].map((id) => `<span class="lg"><i class="lg-sq" style="--day: var(--d${id})"></i>${DAY_NAMES[id]}</span>`).join("")}
          <span class="lg"><i class="lg-sq dl neutral"></i>Deload (rayado)</span>
        </div>
      </section>

      <section class="sec-strength">
        <h3 class="section-title">Fuerza <span class="muted">· reps en 40 s</span></h3>
        <div class="str-grid">
        ${
          strength.length
            ? strength
                .map(
                  (g) => `<div class="card str" style="--day: var(--d${g.dayId})">
          <div class="str-head"><span class="dotc"></span><strong>Día ${g.dayId} — ${esc(DAY_NAMES[g.dayId] || "")}</strong></div>
          ${g.exercises
            .map(
              (e) => `<button class="str-row" data-zoom="ex" data-day="${g.dayId}" data-ex="${e.id}" aria-label="Ampliar ${esc(e.name)}">
              <span class="str-name">${esc(e.name)}</span>
              ${spark(e.points.map((p) => p.y), `var(--d${g.dayId})`, 64, 24)}
              <span class="str-val"><b>${nf(e.last)}</b><small>${e.points.length > 1 ? signed(e.delta) : "—"}</small></span>
            </button>`
            )
            .join("")}
        </div>`
                )
                .join("")
            : `<div class="card muted small">Aún no hay repeticiones registradas.</div>`
        }
        </div>
      </section>

      <dialog id="zoom" class="sheet" aria-labelledby="zoomTitle">
        <div class="sheet-grip" aria-hidden="true"></div>
        <header class="sheet-head">
          <h3 id="zoomTitle"></h3>
          <button class="glass round" id="zoomClose" aria-label="Cerrar">${ICON.close}</button>
        </header>
        <div class="chips" id="zoomChips"></div>
        <div class="legend small" id="zoomLegend"></div>
        <div class="cw xl"><canvas id="cZoom"></canvas></div><p class="muted small cw-msg" hidden></p>
        <details class="zoom-table"><summary>Ver tabla</summary><div id="zoomTable"></div></details>
      </dialog>
    </div>`);

  state.charts = [];
  countUp(app);
  // Sin datos / sin Chart.js: se oculta el lienzo y se muestra un aviso al lado
  // (sin borrar el canvas, para que otro rango pueda volver a pintarlo).
  const showMsg = (canvas, msg) => {
    const box = canvas.closest(".cw");
    box.hidden = !!msg;
    box.nextElementSibling.hidden = !msg;
    box.nextElementSibling.textContent = msg || "";
  };
  const NO_CHART = "Sin conexión para cargar la gráfica.";
  const NO_DATA = "Sin datos en este rango.";
  const untrack = (c) => {
    if (!c) return;
    c.destroy();
    state.charts = (state.charts || []).filter((x) => x !== c);
  };

  let wChart = null;
  let cChart = null;
  const drawMeasures = () => {
    untrack(wChart);
    untrack(cChart);
    wChart = cChart = null;
    const cw = document.getElementById("cWeight");
    const cc = document.getElementById("cWaist");
    const wp = inRange(weightAll, range, today);
    const cp = inRange(waistAll, range, today);
    showMsg(cw, !hasChart ? NO_CHART : wp.length ? "" : NO_DATA);
    showMsg(cc, !hasChart ? NO_CHART : cp.length ? "" : NO_DATA);
    if (hasChart && wp.length) wChart = measureChart(cw, wp, { color: BLUE, goal, unit: " kg" });
    if (hasChart && cp.length) cChart = measureChart(cc, cp, { color: AQUA, unit: " cm" });
    state.charts.push(...[wChart, cChart].filter(Boolean));
  };
  drawMeasures();

  app.querySelectorAll(".pane > .chips .chip").forEach((b) => {
    b.onclick = () => {
      range = b.dataset.range;
      try {
        localStorage.setItem(RANGE_KEY, range);
      } catch (_) {}
      app.querySelectorAll(".pane > .chips .chip").forEach((x) => {
        x.classList.toggle("on", x === b);
        x.setAttribute("aria-pressed", String(x === b));
      });
      drawMeasures();
    };
  });

  // Toque en una casilla del calendario: su detalle en el toast.
  app.querySelector(".heat2").addEventListener("click", (e) => {
    const c = e.target.closest(".hc");
    if (c && !c.classList.contains("fut")) toast(c.dataset.info);
  });

  // ---- ampliar ----
  const dlg = document.getElementById("zoom");
  let zChart = null;
  let zRange = range;
  let current = null;
  const tableHTML = (rows, cols) =>
    `<table><thead><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${rows
      .slice()
      .reverse()
      .map((r) => `<tr>${r.map((v) => `<td>${v}</td>`).join("")}</tr>`)
      .join("")}</tbody></table>`;
  const drawZoom = () => {
    untrack(zChart);
    zChart = null;
    const canvas = document.getElementById("cZoom");
    const legend = document.getElementById("zoomLegend");
    const chips = document.getElementById("zoomChips");
    let pts;
    if (current.kind === "ex") {
      chips.innerHTML = "";
      pts = current.ex.points;
      legend.innerHTML = `<span class="lg"><i class="lg-line" style="--c:var(--d${current.dayId})"></i>Reps / 40 s</span><span class="lg"><i class="lg-tri"></i>Deload</span>`;
      document.getElementById("zoomTable").innerHTML = tableHTML(pts.map((p) => [fmtDayLong(p.date), nf(p.y) + (p.deload ? " · deload" : "")]), ["Fecha", "Reps/40 s"]);
      if (hasChart && pts.length) zChart = strengthChart(canvas, current.ex, cssVar(`--d${current.dayId}`), true);
    } else {
      const isW = current.kind === "weight";
      chips.innerHTML = RANGES.map(([k, t]) => `<button class="chip ${k === zRange ? "on" : ""}" data-r="${k}" aria-pressed="${k === zRange}">${t}</button>`).join("");
      chips.querySelectorAll(".chip").forEach((b) => (b.onclick = () => ((zRange = b.dataset.r), drawZoom())));
      pts = inRange(isW ? weightAll : waistAll, zRange, today);
      legend.innerHTML = `<span class="lg"><i class="lg-line" style="--c:${isW ? BLUE : AQUA}"></i>Media</span><span class="lg"><i class="lg-dot"></i>Registro</span><span class="lg"><i class="lg-tri"></i>Fuera de condiciones</span>${isW ? '<span class="lg"><i class="lg-dash"></i>Objetivo</span>' : ""}`;
      const u = isW ? "kg" : "cm";
      document.getElementById("zoomTable").innerHTML = tableHTML(
        pts.map((p) => [fmtDayLong(p.date), `${nf(p.y)} ${u}${p.std === false ? " ▲" : ""}`, `${nf(p.avg)} ${u}`]),
        ["Fecha", "Registro", "Media 7"]
      );
      if (hasChart && pts.length) zChart = measureChart(canvas, pts, { color: isW ? BLUE : AQUA, goal: isW ? goal : null, big: true, unit: ` ${u}` });
    }
    showMsg(canvas, !hasChart ? NO_CHART : pts.length ? "" : NO_DATA);
    if (zChart) state.charts.push(zChart);
  };
  const openZoom = (spec) => {
    current = spec;
    zRange = range;
    document.getElementById("zoomTitle").textContent =
      spec.kind === "weight" ? "Peso" : spec.kind === "waist" ? "Cintura" : `${spec.ex.name} · Día ${spec.dayId}`;
    dlg.showModal();
    document.documentElement.classList.add("noscroll");
    drawZoom();
  };
  const closeZoom = () => {
    if (dlg.open) dlg.close();
  };
  dlg.addEventListener("close", () => {
    untrack(zChart);
    zChart = null;
    dlg.style.transform = "";
    document.documentElement.classList.remove("noscroll");
  });
  document.getElementById("zoomClose").onclick = closeZoom;
  dlg.addEventListener("click", (e) => {
    // Toque en el backdrop (escritorio). El padding del propio dialog también
    // tiene target === dlg: por eso se mira si el punto cae fuera del rectángulo.
    if (e.target !== dlg) return;
    const r = dlg.getBoundingClientRect();
    const out = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    if (out) closeZoom();
  });
  // Deslizar hacia abajo desde la cabecera para cerrar.
  let y0 = null;
  const head = dlg.querySelector(".sheet-head");
  const grip = dlg.querySelector(".sheet-grip");
  for (const el of [head, grip]) {
    el.addEventListener("touchstart", (e) => (y0 = e.touches[0].clientY), { passive: true });
    el.addEventListener("touchmove", (e) => {
      if (y0 == null) return;
      const dy = Math.max(0, e.touches[0].clientY - y0);
      dlg.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    el.addEventListener("touchend", (e) => {
      const dy = y0 == null ? 0 : e.changedTouches[0].clientY - y0;
      y0 = null;
      if (dy > 90) closeZoom();
      else dlg.style.transform = "";
    });
    el.addEventListener("touchcancel", () => {
      y0 = null;
      dlg.style.transform = "";
    });
  }
  const zoomFrom = (el) => {
    const k = el.dataset.zoom;
    if (k === "ex") {
      const g = strength.find((x) => x.dayId === +el.dataset.day);
      const ex = g?.exercises.find((x) => x.id === +el.dataset.ex);
      if (ex) openZoom({ kind: "ex", dayId: g.dayId, ex });
    } else openZoom({ kind: k });
  };
  app.querySelectorAll("[data-zoom]").forEach((el) => {
    el.addEventListener("click", () => zoomFrom(el));
    el.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && e.target === el && el.tagName !== "BUTTON") {
        e.preventDefault();
        zoomFrom(el);
      }
    });
  });
}

// ------------------------------- boot ---------------------------------
navigator.serviceWorker?.register("/sw.js").catch(() => {});
router();
