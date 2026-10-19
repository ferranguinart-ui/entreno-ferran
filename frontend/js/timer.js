// Motor de timer del entrenamiento.
// - Cuenta atrás anclada a Date.now() (sin acumular drift ni sufrir el
//   throttling de setInterval en segundo plano).
// - Wake Lock para que no se apague la pantalla.
// - Audio (Web Audio) y voz (speechSynthesis) desbloqueados dentro del gesto
//   de "Iniciar" (requisito de iOS).
// - vibrate() sólo donde exista (Android; iOS lo ignora). Vibra aunque esté
//   silenciado.
// - La lógica de "qué suena cuándo" son funciones puras exportadas (testeables
//   en Node); el motor solo las ejecuta.

export function buildSteps(day, warmupExercises, { rounds, remates }) {
  const steps = [];
  const push = (s) => steps.push(s);

  for (const w of warmupExercises) {
    push({
      kind: "warmup",
      phase: "Calentamiento",
      name: w.name,
      seconds: w.work_sec ?? day.work_sec,
      round: 0,
      totalRounds: rounds,
      instructions: w.instructions ?? null,
    });
  }

  const main = day.exercises.filter((e) => e.block === "main");
  for (let r = 1; r <= rounds; r++) {
    main.forEach((ex, i) => {
      const last = i === main.length - 1;
      const lastRound = r === rounds;
      push({
        kind: "work",
        phase: "Trabajo",
        name: ex.name,
        muscle: ex.muscle_primary,
        seconds: ex.work_sec ?? day.work_sec,
        round: r,
        totalRounds: rounds,
        exerciseId: ex.id,
        instructions: ex.instructions ?? null,
      });
      if (!(last && lastRound)) {
        push({
          kind: "rest",
          phase: last ? "Descanso entre rondas" : "Descanso",
          name: "Descanso",
          seconds: last ? day.rest_round_sec : ex.rest_sec ?? day.rest_ex_sec,
          round: r,
          totalRounds: rounds,
        });
      }
    });
  }

  remates.forEach((ex, i) => {
    if (i === 0) {
      push({
        kind: "rest",
        phase: "Descanso",
        name: "Preparar remate",
        seconds: day.rest_ex_sec,
        round: rounds,
        totalRounds: rounds,
      });
    }
    push({
      kind: "work",
      phase: "Remate",
      name: ex.name,
      muscle: ex.muscle_primary,
      seconds: ex.work_sec ?? day.work_sec,
      round: rounds,
      totalRounds: rounds,
      exerciseId: ex.id,
      note: ex.note,
      instructions: ex.instructions ?? null,
    });
  });

  // "siguiente" = próximo bloque de trabajo/calentamiento
  for (let i = 0; i < steps.length; i++) {
    const nxt = steps.slice(i + 1).find((s) => s.kind === "work" || s.kind === "warmup");
    steps[i].nextName = nxt ? nxt.name : "Fin";
    steps[i].nextInstructions = nxt ? nxt.instructions ?? null : null;
  }
  return steps;
}

// ------------------------------- señales ---------------------------------
// Cada tono: {freq Hz, ms duración, delay ms desde "ahora", gain 0..1}.
const tone = (freq, ms, delay = 0, gain = 0.3) => ({ freq, ms, delay, gain });

export const TONES = Object.freeze({
  start: [tone(880, 90)], //                 pulsar Iniciar / Reanudar
  count: [tone(440, 120)], //                3, 2, 1 (grave y corto)
  work: [tone(1046, 450)], //                empieza trabajo/calentamiento (agudo y largo)
  rest: [tone(392, 150), tone(392, 150, 200)], // empieza descanso (doble grave)
  done: [tone(523, 180), tone(659, 180, 200), tone(784, 400, 400)], // fin
  half: [tone(660, 160, 0, 0.12)], //       mitad de un trabajo largo (suave)
});

/** Qué suena y qué se dice al ENTRAR en un paso (o {kind:"done"} al acabar). */
export function stepStartCues(step) {
  switch (step?.kind) {
    case "warmup":
    case "work":
      return { tones: TONES.work, speak: step.name };
    case "rest":
      return {
        tones: TONES.rest,
        speak: step.nextName && step.nextName !== "Fin" ? `Descanso. Siguiente: ${step.nextName}` : "Descanso",
      };
    case "done":
      return { tones: TONES.done, speak: "Entreno terminado" };
    case "blockDone": // acaba el bloque principal pero queda remate
      return { tones: TONES.rest, speak: "Bloque terminado" };
    default:
      return { tones: [], speak: null };
  }
}

/** Tonos a reproducir al pasar de prevSec a curSec dentro de un mismo paso.
 *  Por cruce de umbral: no repite y tolera saltos (p. ej. tras segundo plano). */
export function tickCues(step, prevSec, curSec) {
  if (prevSec == null || curSec == null || curSec >= prevSec) return [];
  const crossed = (k) => prevSec > k && curSec <= k;
  const out = [];
  if (step?.kind === "work" && step.seconds >= 45 && crossed(Math.ceil(step.seconds / 2))) {
    out.push(...TONES.half);
  }
  if (crossed(3) || crossed(2) || crossed(1)) out.push(...TONES.count);
  return out;
}

/** Paso sintético que suena al terminar el motor: fin de entreno o solo de bloque. */
export function finishCue(finalCue = true) {
  return { kind: finalCue ? "done" : "blockDone" };
}

export function primaryLabel(status) {
  if (status === "running") return "Pausa";
  if (status === "paused") return "Reanudar";
  return "Iniciar";
}

// ------------------------------- silencio --------------------------------
export const MUTE_KEY = "entreno.muted";

export function readMuted(storage) {
  try {
    return storage?.getItem(MUTE_KEY) === "1";
  } catch (_) {
    return false;
  }
}

export function writeMuted(storage, value) {
  try {
    storage?.setItem(MUTE_KEY, value ? "1" : "0");
  } catch (_) {}
}

// -------------------------------- entorno --------------------------------
const hasDoc = () => typeof document !== "undefined";
const raf = (cb) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(cb) : null);
const caf = (id) => {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
};
const synth = () => (typeof speechSynthesis !== "undefined" ? speechSynthesis : null);
const nav = () => (typeof navigator !== "undefined" ? navigator : null);

// Un único AudioContext para toda la app: iOS limita cuántos puede haber vivos
// y cada entreno (y el remate) crea un motor nuevo.
let sharedAudio = null;
function audioContext() {
  try {
    if (!sharedAudio) {
      const Ctx = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
      if (!Ctx) return null;
      sharedAudio = new Ctx();
    }
    if (sharedAudio.state !== "running") sharedAudio.resume?.();
    return sharedAudio;
  } catch (_) {
    return null;
  }
}

export class TimerEngine {
  constructor(steps, { onTick, onStep, onDone, muted = false, finalCue = true } = {}) {
    this.steps = steps;
    this.onTick = onTick || (() => {});
    this.onStep = onStep || (() => {});
    this.onDone = onDone || (() => {});
    this.muted = !!muted;
    this.finalCue = finalCue !== false; // false: queda remate, no anunciar fin de entreno
    this.i = 0;
    this.started = false;
    this.finished = false;
    this.running = false;
    this.stepEndsAt = 0;
    this.remainingMs = 0;
    this.t0 = 0;
    this.pausedAccum = 0;
    this.pauseStart = 0;
    this.endedAt = 0;
    this._lastSec = null;
    this._raf = null;
    this._wake = null;
    this._audio = null;
    this._onVis = () => {
      if (this.running && hasDoc() && document.visibilityState === "visible") {
        this._acquireWake();
        this._loop();
      }
    };
  }

  get step() {
    return this.steps[this.i];
  }

  /** idle (sin iniciar) | running | paused | done */
  get status() {
    if (this.finished) return "done";
    if (this.running) return "running";
    return this.started ? "paused" : "idle";
  }

  /** Acción del botón principal: Iniciar / Pausa / Reanudar. */
  toggle() {
    const s = this.status;
    if (s === "idle") this.start();
    else if (s === "running") this.pause();
    else if (s === "paused") this.resume();
  }

  // Síncrono a propósito: el desbloqueo de audio/voz tiene que ocurrir dentro
  // del gesto del usuario, antes de cualquier await.
  start() {
    if (this.started || this.finished) return;
    this._unlockAudio();
    this._unlockSpeech();
    this.started = true;
    this._acquireWake(); // sin await
    if (hasDoc()) document.addEventListener("visibilitychange", this._onVis);
    this.t0 = Date.now();
    this.running = true;
    this.stepEndsAt = Date.now() + this.step.seconds * 1000;
    this._lastSec = null;
    this._playTones(TONES.start);
    this._stepCues(this.step, 200);
    this.onStep(this.step, this.i);
    this._loop();
  }

  _loop() {
    caf(this._raf);
    const tick = () => {
      if (!this.running) return;
      const remaining = this.stepEndsAt - Date.now();
      if (remaining <= 0) {
        this._advance();
        return;
      }
      const sec = Math.ceil(remaining / 1000);
      this._playTones(tickCues(this.step, this._lastSec, sec));
      this._lastSec = sec;
      this.onTick(sec, this.step, this.i, remaining);
      this._raf = raf(tick);
    };
    tick();
  }

  _advance() {
    if (this.i >= this.steps.length - 1) return this._finish();
    const prevEnd = this.stepEndsAt;
    this.i += 1;
    this.stepEndsAt = prevEnd + this.step.seconds * 1000; // carry-over, sin drift
    this._lastSec = null;
    // Al volver de segundo plano se pueden encadenar varios _advance seguidos:
    // solo suena el paso que de verdad está en curso.
    if (this.stepEndsAt > Date.now()) this._stepCues(this.step);
    this.onStep(this.step, this.i);
    this._loop();
  }

  pause() {
    if (!this.running) return;
    this.running = false;
    this.remainingMs = Math.max(0, this.stepEndsAt - Date.now());
    this.pauseStart = Date.now();
    caf(this._raf);
  }

  resume() {
    if (!this.started) return this.start();
    if (this.running || this.finished) return;
    this._unlockAudio();
    this._unlockSpeech();
    this.pausedAccum += Date.now() - this.pauseStart;
    this.stepEndsAt = Date.now() + this.remainingMs;
    this.running = true;
    this._acquireWake();
    this._playTones(TONES.start);
    this._loop();
  }

  _jump(to) {
    this.i = to;
    this.stepEndsAt = Date.now() + this.step.seconds * 1000;
    this.remainingMs = this.step.seconds * 1000; // por si se reanuda desde pausa
    this._lastSec = null;
    if (this.running) this._stepCues(this.step);
    this.onStep(this.step, this.i);
    if (this.running) this._loop();
    else this.onTick(this.step.seconds, this.step, this.i, this.step.seconds * 1000);
  }

  skip() {
    if (this.finished) return;
    if (this.i >= this.steps.length - 1) {
      if (this.started) this._finish();
      return;
    }
    this._jump(this.i + 1);
  }

  back() {
    if (this.finished) return;
    this._jump(Math.max(0, this.i - 1));
  }

  /** Parada desde fuera (salir, cambiar de vista): también calla la voz. */
  stop() {
    this._teardown();
    try {
      synth()?.cancel();
    } catch (_) {}
  }

  _teardown() {
    this.running = false;
    caf(this._raf);
    if (hasDoc()) document.removeEventListener("visibilitychange", this._onVis);
    this._releaseWake();
  }

  durationSec() {
    if (!this.started) return 0;
    // Terminado: hasta el final. En pausa: hasta el inicio de la pausa.
    const end = this.finished ? this.endedAt : this.running ? Date.now() : this.pauseStart || Date.now();
    return Math.max(0, Math.round((end - this.t0 - this.pausedAccum) / 1000));
  }

  setMuted(v) {
    this.muted = !!v;
    if (this.muted) {
      try {
        synth()?.cancel();
      } catch (_) {}
    }
  }

  _finish() {
    if (this.finished) return;
    this.finished = true;
    this.endedAt = Date.now();
    // Terminado desde pausa (skip en el último paso): la pausa no cuenta.
    if (!this.running && this.pauseStart) this.pausedAccum += this.endedAt - this.pauseStart;
    this.running = false;
    caf(this._raf);
    this._stepCues(finishCue(this.finalCue));
    this._teardown(); // no stop(): cancelaría la voz del aviso final
    this.onDone();
  }

  // --- señales ---
  _stepCues(step, offset = 0) {
    const { tones, speak } = stepStartCues(step);
    this._playTones(tones, offset);
    this._speak(speak);
    try {
      nav()?.vibrate?.(step.kind === "done" ? [120, 80, 120] : [120]);
    } catch (_) {}
  }

  _playTones(tones, offset = 0) {
    for (const t of tones) this._beep(t.freq, t.ms, t.delay + offset, t.gain);
  }

  _speak(text) {
    if (!text || this.muted) return;
    const s = synth();
    if (!s || typeof SpeechSynthesisUtterance === "undefined") return;
    try {
      s.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "es-ES";
      u.rate = 1.05;
      const voices = s.getVoices?.() || [];
      const v =
        voices.find((x) => /^es[-_]ES/i.test(x.lang)) || voices.find((x) => /^es/i.test(x.lang));
      if (v) u.voice = v;
      s.speak(u);
    } catch (_) {}
  }

  // --- audio ---
  _unlockAudio() {
    this._audio = audioContext();
  }

  // iOS solo deja hablar fuera de un gesto si antes se habló dentro de uno.
  _unlockSpeech() {
    const s = synth();
    if (!s || typeof SpeechSynthesisUtterance === "undefined") return;
    try {
      const u = new SpeechSynthesisUtterance("");
      u.volume = 0;
      s.speak(u);
    } catch (_) {}
  }

  _beep(freq, ms, delay = 0, peak = 0.3) {
    if (!this._audio || this.muted) return;
    try {
      const ctx = this._audio;
      const t = ctx.currentTime + delay / 1000;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(peak, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + ms / 1000 + 0.02);
    } catch (_) {}
  }

  // --- wake lock ---
  async _acquireWake() {
    if (this._wake && !this._wake.released) return; // ya lo tenemos
    try {
      const lock = (await nav()?.wakeLock?.request("screen")) || null;
      // Sin await en start(): si se paró mientras tanto, no lo retengas.
      if (lock && !this.running) lock.release();
      else this._wake = lock;
    } catch (_) {
      this._wake = null;
    }
  }

  _releaseWake() {
    try {
      this._wake?.release();
    } catch (_) {}
    this._wake = null;
  }
}
