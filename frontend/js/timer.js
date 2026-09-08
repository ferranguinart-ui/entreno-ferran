// Motor de timer del entrenamiento.
// - Cuenta atrás anclada a Date.now() (sin acumular drift ni sufrir el
//   throttling de setInterval en segundo plano).
// - Wake Lock para que no se apague la pantalla.
// - Audio desbloqueado en el primer gesto (start()); beeps por Web Audio.
// - vibrate() sólo donde exista (Android; iOS lo ignora).

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
    });
  });

  // "siguiente" = próximo bloque de trabajo/calentamiento
  for (let i = 0; i < steps.length; i++) {
    const nxt = steps.slice(i + 1).find((s) => s.kind === "work" || s.kind === "warmup");
    steps[i].nextName = nxt ? nxt.name : "Fin";
  }
  return steps;
}

export class TimerEngine {
  constructor(steps, { onTick, onStep, onDone }) {
    this.steps = steps;
    this.onTick = onTick;
    this.onStep = onStep;
    this.onDone = onDone;
    this.i = 0;
    this.running = false;
    this.stepEndsAt = 0;
    this.remainingMs = 0;
    this.t0 = 0;
    this.pausedAccum = 0;
    this.pauseStart = 0;
    this._raf = null;
    this._wake = null;
    this._audio = null;
    this._onVis = () => {
      if (this.running && document.visibilityState === "visible") {
        this._acquireWake();
        this._loop();
      }
    };
  }

  get step() {
    return this.steps[this.i];
  }

  async start() {
    this._unlockAudio();
    await this._acquireWake();
    document.addEventListener("visibilitychange", this._onVis);
    this.t0 = Date.now();
    this.running = true;
    this.stepEndsAt = Date.now() + this.step.seconds * 1000;
    this.onStep(this.step, this.i);
    this._loop();
  }

  _loop() {
    cancelAnimationFrame(this._raf);
    const tick = () => {
      if (!this.running) return;
      const remaining = this.stepEndsAt - Date.now();
      if (remaining <= 0) {
        this._cue(this.step);
        this._advance();
        return;
      }
      this.onTick(Math.ceil(remaining / 1000), this.step, this.i);
      this._raf = requestAnimationFrame(tick);
    };
    tick();
  }

  _advance() {
    if (this.i >= this.steps.length - 1) return this._finish();
    const prevEnd = this.stepEndsAt;
    this.i += 1;
    this.stepEndsAt = prevEnd + this.step.seconds * 1000; // carry-over, sin drift
    this.onStep(this.step, this.i);
    this._loop();
  }

  pause() {
    if (!this.running) return;
    this.running = false;
    this.remainingMs = Math.max(0, this.stepEndsAt - Date.now());
    this.pauseStart = Date.now();
    cancelAnimationFrame(this._raf);
  }

  resume() {
    if (this.running) return;
    this.pausedAccum += Date.now() - this.pauseStart;
    this.stepEndsAt = Date.now() + this.remainingMs;
    this.running = true;
    this._loop();
  }

  skip() {
    if (this.i >= this.steps.length - 1) return this._finish();
    this.i += 1;
    this.stepEndsAt = Date.now() + this.step.seconds * 1000;
    this.onStep(this.step, this.i);
    if (this.running) this._loop();
    else this.onTick(this.step.seconds, this.step, this.i);
  }

  back() {
    this.i = Math.max(0, this.i - 1);
    this.stepEndsAt = Date.now() + this.step.seconds * 1000;
    this.onStep(this.step, this.i);
    if (this.running) this._loop();
    else this.onTick(this.step.seconds, this.step, this.i);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    document.removeEventListener("visibilitychange", this._onVis);
    this._releaseWake();
  }

  durationSec() {
    const end = this.running ? Date.now() : this.pauseStart || Date.now();
    return Math.round((end - this.t0 - this.pausedAccum) / 1000);
  }

  _finish() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    this._cue({ kind: "done" });
    this.stop();
    this.onDone();
  }

  // --- audio ---
  _unlockAudio() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this._audio = this._audio || new Ctx();
      if (this._audio.state === "suspended") this._audio.resume();
    } catch (_) {
      this._audio = null;
    }
  }

  _cue(step) {
    let freq = 880;
    let beeps = 1;
    if (step.kind === "rest") freq = 440;
    else if (step.kind === "work") freq = step.round === 1 ? 880 : 990;
    else if (step.kind === "done") {
      freq = 660;
      beeps = 3;
    }
    for (let k = 0; k < beeps; k++) this._beep(freq, 140, k * 180);
    try {
      navigator.vibrate?.(step.kind === "done" ? [120, 80, 120] : [120]);
    } catch (_) {}
  }

  _beep(freq, ms, delay = 0) {
    if (!this._audio) return;
    const ctx = this._audio;
    const t = ctx.currentTime + delay / 1000;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + ms / 1000 + 0.02);
  }

  // --- wake lock ---
  async _acquireWake() {
    try {
      this._wake = await navigator.wakeLock?.request("screen");
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
