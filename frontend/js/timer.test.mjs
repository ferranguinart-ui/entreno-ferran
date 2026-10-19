import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSteps,
  TONES,
  stepStartCues,
  tickCues,
  primaryLabel,
  MUTE_KEY,
  readMuted,
  writeMuted,
  TimerEngine,
  finishCue,
} from "./timer.js";

const day = {
  id: 1,
  name: "Empuje",
  work_sec: 40,
  rest_ex_sec: 25,
  rest_round_sec: 90,
  exercises: [
    { id: 10, block: "main", name: "Press pecho", muscle_primary: "Pectoral", instructions: "Empuja arriba." },
    { id: 11, block: "main", name: "Aperturas", muscle_primary: "Pectoral", instructions: "Abre en arco." },
    { id: 13, block: "main", name: "Rompe cráneos", muscle_primary: "Tríceps" },
    { id: 14, block: "remate", name: "Flexiones", work_sec: 40, is_optional: true, instructions: "Cuerpo en línea." },
  ],
};
const warm = [
  { name: "Jumping jacks", work_sec: 30, instructions: "Salta abriendo." },
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

// ------------------------- instrucciones en pasos -------------------------
test("buildSteps: instructions en pasos de trabajo/calentamiento/remate (null si falta)", () => {
  const s = buildSteps(day, warm, { rounds: 1, remates: [] });
  assert.equal(s[0].instructions, "Salta abriendo.");
  assert.equal(s[1].instructions, null, "warmup sin instrucciones -> null");
  const work = s.filter((x) => x.kind === "work");
  assert.equal(work[0].instructions, "Empuja arriba.");
  assert.equal(work[2].instructions, null);
  const r = buildSteps(day, [], { rounds: 0, remates: [day.exercises[3]] });
  assert.equal(r[1].instructions, "Cuerpo en línea.");
});

test("buildSteps: nextInstructions apunta al siguiente trabajo (o null)", () => {
  const s = buildSteps(day, [], { rounds: 1, remates: [] });
  // work Press, rest, work Aperturas, rest, work Rompe
  assert.equal(s[1].kind, "rest");
  assert.equal(s[1].nextName, "Aperturas");
  assert.equal(s[1].nextInstructions, "Abre en arco.");
  assert.equal(s[3].nextInstructions, null, "Rompe cráneos no tiene instrucciones");
  assert.equal(s.at(-1).nextInstructions, null, "tras el último: null");
  const r = buildSteps(day, [], { rounds: 0, remates: [day.exercises[3]] });
  assert.equal(r[0].nextInstructions, "Cuerpo en línea.");
});

// ---------------------------------- tonos ----------------------------------
test("TONES: tuplas {freq, ms, delay, gain} y perfiles distintos", () => {
  for (const [k, list] of Object.entries(TONES)) {
    assert.ok(Array.isArray(list) && list.length > 0, k);
    for (const t of list) {
      for (const f of ["freq", "ms", "delay", "gain"]) assert.equal(typeof t[f], "number", `${k}.${f}`);
    }
  }
  assert.equal(TONES.start[0].freq, 880);
  assert.ok(TONES.start[0].ms < TONES.work[0].ms, "start corto, work largo");
  assert.equal(TONES.count[0].freq, 440);
  assert.equal(TONES.count[0].ms, 120);
  assert.ok(TONES.work[0].freq > 1000 && TONES.work[0].ms >= 400);
  assert.equal(TONES.rest.length, 2);
  assert.ok(TONES.rest.every((t) => t.freq === 392));
  assert.deepEqual(TONES.done.map((t) => t.freq), [523, 659, 784]);
  assert.equal(TONES.half[0].gain, 0.12);
});

test("stepStartCues: trabajo/calentamiento -> tono work + nombre", () => {
  assert.deepEqual(stepStartCues({ kind: "work", name: "Press" }), { tones: TONES.work, speak: "Press" });
  assert.deepEqual(stepStartCues({ kind: "warmup", name: "Jumping jacks" }), {
    tones: TONES.work,
    speak: "Jumping jacks",
  });
});

test("stepStartCues: descanso anuncia el siguiente (salvo Fin)", () => {
  assert.deepEqual(stepStartCues({ kind: "rest", name: "Descanso", nextName: "Aperturas" }), {
    tones: TONES.rest,
    speak: "Descanso. Siguiente: Aperturas",
  });
  assert.deepEqual(stepStartCues({ kind: "rest", name: "Descanso", nextName: "Fin" }), {
    tones: TONES.rest,
    speak: "Descanso",
  });
});

test("stepStartCues: done -> melodía + Entreno terminado", () => {
  assert.deepEqual(stepStartCues({ kind: "done" }), { tones: TONES.done, speak: "Entreno terminado" });
});

test("tickCues: nada sin segundo previo o sin cambio", () => {
  const w = { kind: "work", seconds: 40 };
  assert.deepEqual(tickCues(w, null, 3), []);
  assert.deepEqual(tickCues(w, 3, 3), []);
  assert.deepEqual(tickCues(w, 10, 9), []);
});

test("tickCues: cuenta atrás al cruzar 3, 2 y 1", () => {
  const w = { kind: "rest", seconds: 25 };
  assert.deepEqual(tickCues(w, 4, 3), TONES.count);
  assert.deepEqual(tickCues(w, 3, 2), TONES.count);
  assert.deepEqual(tickCues(w, 2, 1), TONES.count);
  assert.deepEqual(tickCues(w, 10, 2), TONES.count, "salto también avisa, una sola vez");
  assert.deepEqual(tickCues(w, 2, 3), [], "subir no suena");
});

test("tickCues: aviso de mitad solo en trabajo >= 45 s, una vez", () => {
  const w60 = { kind: "work", seconds: 60 };
  assert.deepEqual(tickCues(w60, 31, 30), TONES.half);
  assert.deepEqual(tickCues(w60, 30, 29), []);
  assert.deepEqual(tickCues(w60, 40, 20), TONES.half, "con salto");
  const w45 = { kind: "work", seconds: 45 }; // mitad = ceil(22.5) = 23
  assert.deepEqual(tickCues(w45, 24, 23), TONES.half);
  assert.deepEqual(tickCues({ kind: "work", seconds: 40 }, 21, 20), []);
  assert.deepEqual(tickCues({ kind: "rest", seconds: 90 }, 46, 45), []);
});

test("primaryLabel según estado", () => {
  assert.equal(primaryLabel("idle"), "Iniciar");
  assert.equal(primaryLabel("running"), "Pausa");
  assert.equal(primaryLabel("paused"), "Reanudar");
  assert.equal(primaryLabel("done"), "Iniciar");
});

test("readMuted / writeMuted con storage y tolerantes a fallos", () => {
  const mem = new Map();
  const st = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
  assert.equal(readMuted(st), false);
  writeMuted(st, true);
  assert.ok(mem.has(MUTE_KEY));
  assert.equal(readMuted(st), true);
  writeMuted(st, false);
  assert.equal(readMuted(st), false);
  const broken = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); } };
  assert.equal(readMuted(broken), false);
  assert.doesNotThrow(() => writeMuted(broken, true));
  assert.equal(readMuted(undefined), false);
  assert.doesNotThrow(() => writeMuted(undefined, true));
});

// --------------------------------- engine ----------------------------------
// Entorno mínimo: sin rAF real (el bucle hace un único tick síncrono).
globalThis.document ??= { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
globalThis.requestAnimationFrame ??= () => 0;
globalThis.cancelAnimationFrame ??= () => {};

const mkSteps = () => buildSteps(day, [], { rounds: 1, remates: [] });
const mkEngine = (steps = mkSteps()) => {
  const calls = { step: [], tick: [], done: 0 };
  const e = new TimerEngine(steps, {
    onTick: (s, st, i) => calls.tick.push([s, i]),
    onStep: (st, i) => calls.step.push(i),
    onDone: () => (calls.done += 1),
  });
  return { e, calls };
};

test("engine: estado inicial idle, sin arrancar", () => {
  const { e, calls } = mkEngine();
  assert.equal(e.status, "idle");
  assert.equal(e.started, false);
  assert.equal(e.finished, false);
  assert.equal(e.i, 0);
  assert.equal(e.durationSec(), 0);
  assert.equal(calls.step.length, 0);
});

test("engine: toggle arranca en el paso 0, luego pausa y reanuda", () => {
  const { e, calls } = mkEngine();
  e.toggle();
  assert.equal(e.status, "running");
  assert.equal(e.i, 0);
  assert.deepEqual(calls.step, [0]);
  e.toggle();
  assert.equal(e.status, "paused");
  e.toggle();
  assert.equal(e.status, "running");
  assert.equal(e.i, 0);
  e.stop();
});

test("engine: durationSec 0 antes de iniciar y pequeño después", () => {
  const { e } = mkEngine();
  assert.equal(e.durationSec(), 0);
  e.start();
  const d = e.durationSec();
  assert.ok(d >= 0 && d < 5, `duración ${d}`);
  e.stop();
});

test("engine: resume() sin start() equivale a start() (no salta el paso 0)", () => {
  const { e, calls } = mkEngine();
  e.resume();
  assert.equal(e.status, "running");
  assert.equal(e.i, 0);
  assert.deepEqual(calls.step, [0]);
  assert.ok(e.stepEndsAt - Date.now() > 30_000, "el paso 0 conserva su tiempo");
  e.stop();
});

test("engine: start() doble es idempotente (un solo onStep)", () => {
  const { e, calls } = mkEngine();
  e.start();
  e.start();
  assert.deepEqual(calls.step, [0]);
  e.stop();
});

test("engine: skip en idle sobre el último paso no termina el entreno", () => {
  const steps = mkSteps();
  const { e, calls } = mkEngine(steps);
  e.i = steps.length - 1;
  e.skip();
  assert.equal(calls.done, 0);
  assert.equal(e.finished, false);
  assert.equal(e.status, "idle");
});

test("engine: skip en pausa conserva el tiempo completo del paso nuevo al reanudar", () => {
  const { e } = mkEngine();
  e.start();
  e.pause();
  e.skip();
  assert.equal(e.i, 1);
  e.resume();
  const left = e.stepEndsAt - Date.now();
  assert.ok(left > (e.step.seconds - 1) * 1000, `quedan ${left} ms`);
  e.stop();
});

test("engine: terminar -> status done, onDone una vez y toggle ya no hace nada", () => {
  const steps = mkSteps();
  const { e, calls } = mkEngine(steps);
  e.start();
  e.i = steps.length - 1;
  e.skip();
  assert.equal(calls.done, 1);
  assert.equal(e.status, "done");
  e.toggle();
  assert.equal(e.status, "done");
  assert.equal(calls.done, 1);
});

test("engine: setMuted y opción muted", () => {
  const e = new TimerEngine(mkSteps(), { onTick() {}, onStep() {}, onDone() {}, muted: true });
  assert.equal(e.muted, true);
  e.setMuted(false);
  assert.equal(e.muted, false);
});

const spyCues = (e) => {
  const seen = [];
  e._stepCues = (step) => seen.push(step.kind === "done" ? "done" : step.name);
  return seen;
};

test("engine: al cambiar de paso suenan las señales del paso NUEVO", () => {
  const { e } = mkEngine();
  e.start();
  const seen = spyCues(e);
  e.stepEndsAt = Date.now() - 1; // el paso 0 acaba de terminar
  e._loop();
  assert.equal(e.i, 1);
  assert.deepEqual(seen, ["Descanso"]);
  e.stop();
});

test("engine: al volver de segundo plano no hay ráfaga (solo el paso en curso)", () => {
  const steps = mkSteps(); // 40 + 25 + 40 + 25 + 40
  const { e, calls } = mkEngine(steps);
  e.start();
  const seen = spyCues(e);
  e.stepEndsAt = Date.now() - 70_000; // se han perdido paso 0 (ya), 1 y parte del 2
  e._loop();
  assert.equal(e.i, 3);
  assert.deepEqual(seen, ["Descanso"], "solo suena el paso 3");
  assert.deepEqual(calls.step, [0, 1, 2, 3]);
  e.stop();
});

test("engine: skip/back en pausa no suenan; en marcha sí", () => {
  const { e } = mkEngine();
  e.start();
  const seen = spyCues(e);
  e.skip();
  assert.deepEqual(seen, ["Descanso"]);
  e.pause();
  e.skip();
  e.back();
  assert.deepEqual(seen, ["Descanso"]);
  e.stop();
});

test("engine: el contador de tick se reinicia al cambiar de paso", () => {
  const { e } = mkEngine();
  e.start();
  assert.equal(e._lastSec, 40);
  e.skip();
  assert.equal(e._lastSec, 25, "tras el tick del paso nuevo");
  e.pause();
  e.back();
  assert.equal(e._lastSec, null);
  e.stop();
});

test("engine: durationSec al terminar no usa el instante de una pausa anterior", () => {
  const steps = mkSteps();
  const { e } = mkEngine(steps);
  e.start();
  e.pause();
  e.resume();
  // Simula: arrancó hace 100 s, pausa de 10 s hace 60 s.
  const now = Date.now();
  e.t0 = now - 100_000;
  e.pauseStart = now - 60_000;
  e.pausedAccum = 10_000;
  e.i = steps.length - 1;
  e.skip(); // termina
  assert.equal(e.status, "done");
  const d = e.durationSec();
  assert.ok(d >= 89 && d <= 91, `duración ${d}, esperaba ~90`);
});

test("engine: terminar desde pausa no cuenta el tiempo en pausa", () => {
  const steps = mkSteps();
  const { e } = mkEngine(steps);
  e.start();
  const now = Date.now();
  e.t0 = now - 100_000;
  e.pause();
  e.pauseStart = now - 40_000; // lleva 40 s en pausa
  e.i = steps.length - 1;
  e.skip();
  const d = e.durationSec();
  assert.ok(d >= 59 && d <= 61, `duración ${d}, esperaba ~60`);
});

// ---------------------- ajustes tras la revisión (sección 3) ----------------------
test("stepStartCues: fin de bloque (hay remate) -> doble pitido de descanso + Bloque terminado", () => {
  assert.deepEqual(stepStartCues({ kind: "blockDone" }), { tones: TONES.rest, speak: "Bloque terminado" });
});

test("finishCue: finalCue true -> done; false -> blockDone", () => {
  assert.equal(finishCue(true).kind, "done");
  assert.equal(finishCue(false).kind, "blockDone");
  const e1 = new TimerEngine(mkSteps(), {});
  assert.equal(e1.finalCue, true, "por defecto true");
  const e2 = new TimerEngine(mkSteps(), { finalCue: false });
  assert.equal(e2.finalCue, false);
});

test("engine: _finish usa la señal según finalCue", () => {
  for (const [finalCue, want] of [[true, "done"], [false, "blockDone"]]) {
    const steps = mkSteps();
    const e = new TimerEngine(steps, { finalCue });
    e.start();
    const seen = [];
    e._stepCues = (st) => seen.push(st.kind);
    e.i = steps.length - 1;
    e.skip();
    assert.deepEqual(seen, [want]);
  }
});

const withSpeech = (fn) => {
  const log = { cancel: 0, speak: [] };
  const prevS = globalThis.speechSynthesis;
  const prevU = globalThis.SpeechSynthesisUtterance;
  globalThis.speechSynthesis = {
    cancel: () => (log.cancel += 1),
    speak: (u) => log.speak.push({ text: u.text, volume: u.volume }),
    getVoices: () => [],
  };
  globalThis.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
      this.volume = 1;
    }
  };
  try {
    fn(log);
  } finally {
    globalThis.speechSynthesis = prevS;
    globalThis.SpeechSynthesisUtterance = prevU;
    if (prevS === undefined) delete globalThis.speechSynthesis;
    if (prevU === undefined) delete globalThis.SpeechSynthesisUtterance;
  }
};

test("engine: stop() cancela la voz; _finish() no (deja oír el aviso final)", () => {
  withSpeech((log) => {
    const steps = mkSteps();
    const e = new TimerEngine(steps, {});
    e.start();
    const before = log.cancel;
    e.i = steps.length - 1;
    e.skip(); // _finish
    // _speak hace un cancel previo propio; tras él no debe haber otro cancel.
    assert.equal(log.speak.at(-1).text, "Entreno terminado");
    const afterFinish = log.cancel;
    assert.equal(afterFinish - before, 1, "solo el cancel previo de _speak");

    const e2 = new TimerEngine(mkSteps(), {});
    e2.start();
    const c0 = log.cancel;
    e2.stop();
    assert.equal(log.cancel, c0 + 1);
  });
});

test("engine: start() hace el speak de desbloqueo (volumen 0) de forma síncrona", () => {
  withSpeech((log) => {
    const e = new TimerEngine(mkSteps(), { muted: true });
    e.start(); // silenciado: solo debe hablar el desbloqueo
    assert.equal(log.speak.length, 1);
    assert.deepEqual(log.speak[0], { text: "", volume: 0 });
    e.stop();
  });
});

test("audio: un único AudioContext compartido entre motores, con resume en start/resume", () => {
  let created = 0;
  let resumes = 0;
  class FakeCtx {
    constructor() {
      created += 1;
      this.state = "suspended";
    }
    resume() {
      resumes += 1;
    }
  }
  const prevW = globalThis.window;
  globalThis.window = { AudioContext: FakeCtx };
  try {
    const a = new TimerEngine(mkSteps(), { muted: true });
    a.start();
    a.pause();
    a.resume();
    a.stop();
    const b = new TimerEngine(mkSteps(), { muted: true });
    b.start();
    b.stop();
    assert.ok(created <= 1, `contextos creados: ${created}`);
    assert.equal(resumes, 3, "start + resume + start");
    assert.equal(a._audio, b._audio);
  } finally {
    if (prevW === undefined) delete globalThis.window;
    else globalThis.window = prevW;
  }
});
