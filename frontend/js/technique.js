// Ilustraciones de técnica: posición de inicio y final de cada ejercicio.
// Un maniquí de perfil (mirando a la derecha) se dibuja a partir de una postura
// = posición de la cadera + ángulo absoluto de cada segmento. Así todas las
// imágenes comparten estilo y corregir una postura es cambiar un número.
// Puro (sin DOM): devuelve SVG en texto. El color lo pone el CSS (.tq-*).
//
// Ángulos en grados, 0 = derecha, 90 = arriba (como en matemáticas; el eje y
// del SVG va hacia abajo y se invierte aquí). `k` = escorzo (0..1) para un
// segmento que sale hacia la cámara y se ve más corto.

const LEN = { torso: 42, neck: 6, head: 9, upper: 26, fore: 24, thigh: 34, shin: 32, foot: 10 };
const W = { torso: 20, upper: 10, fore: 9, thigh: 14, shin: 11, foot: 6 };

const rad = (a) => (a * Math.PI) / 180;
const step = ([x, y], ang, len) => [x + len * Math.cos(rad(ang)), y - len * Math.sin(rad(ang))];
const r1 = (n) => Math.round(n * 10) / 10;
const pt = ([x, y]) => `${r1(x)},${r1(y)}`;

/** Ángulo o [ángulo, escorzo] → {a, k}. */
const seg = (v) => (Array.isArray(v) ? { a: v[0], k: v[1] } : { a: v, k: 1 });

/** Cinemática inversa de dos segmentos: ángulos para que el extremo llegue a T.
 *  bend = +1 / -1 elige hacia qué lado se dobla la articulación. */
function ik(A, T, l1, l2, bend) {
  const dx = T[0] - A[0], dy = A[1] - T[1];
  const d = Math.min(Math.max(Math.hypot(dx, dy), Math.abs(l1 - l2) + 0.01), l1 + l2 - 0.01);
  const base = (Math.atan2(dy, dx) * 180) / Math.PI;
  const a = (Math.acos((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)) * 180) / Math.PI;
  const a1 = base + bend * a;
  const J = step(A, a1, l1);
  return [a1, (Math.atan2(J[1] - T[1], T[0] - J[0]) * 180) / Math.PI];
}

/** Puntos del cuerpo a partir de la postura. Un brazo/pierna puede darse con
 *  ángulos ([a1, a2(, pie)]) o con su destino ({to: [x, y], bend, foot}). */
export function skeleton(p) {
  const hip = p.hip;
  const t = seg(p.torso);
  const shoulder = step(hip, t.a, LEN.torso * t.k);
  const h = seg(p.head ?? p.torso);
  const head = step(shoulder, h.a, LEN.neck + LEN.head);
  const limb = (from, [a1, a2, a3], [l1, l2, l3]) => {
    const s1 = seg(a1), s2 = seg(a2);
    const j1 = step(from, s1.a, l1 * s1.k);
    const j2 = step(j1, s2.a, l2 * s2.k);
    const j3 = a3 == null ? null : step(j2, seg(a3).a, l3 * seg(a3).k);
    return [from, j1, j2, j3];
  };
  const arm = (v) => {
    if (!Array.isArray(v)) v = ik(shoulder, v.to, LEN.upper, LEN.fore, v.bend ?? 1);
    return limb(shoulder, [v[0], v[1]], [LEN.upper, LEN.fore]);
  };
  const leg = (v) => {
    if (!Array.isArray(v)) v = [...ik(hip, v.to, LEN.thigh, LEN.shin, v.bend ?? 1), v.foot ?? 0];
    return limb(hip, v, [LEN.thigh, LEN.shin, LEN.foot]);
  };
  return {
    hip, shoulder, head,
    armNear: arm(p.armNear), armFar: arm(p.armFar ?? p.armNear),
    legNear: leg(p.legNear), legFar: leg(p.legFar ?? p.legNear),
  };
}

const line = (a, b, w, cls, extra = "") =>
  `<line class="${cls}" x1="${r1(a[0])}" y1="${r1(a[1])}" x2="${r1(b[0])}" y2="${r1(b[1])}" stroke-width="${w}"${extra}/>`;

/** Trozo de un segmento [a→b] entre las fracciones f0..f1, desplazado `off` en la normal (+ = "arriba" del segmento). */
function part(a, b, f0, f1, off) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = dy / len, ny = -dx / len; // normal a la izquierda del sentido a→b
  const P = (f) => [a[0] + dx * f + nx * off, a[1] + dy * f + ny * off];
  return [P(f0), P(f1)];
}

// Zonas resaltables: segmento del esqueleto + tramo + lado.
const ZONES = {
  chest: (s) => ({ seg: [s.hip, s.shoulder], f: [0.55, 0.95], off: -5, w: 9 }), // delante del torso
  back: (s) => ({ seg: [s.hip, s.shoulder], f: [0.35, 0.9], off: 5, w: 9 }), // espalda (dorsal)
  lowBack: (s) => ({ seg: [s.hip, s.shoulder], f: [0.05, 0.35], off: 5, w: 8 }),
  abs: (s) => ({ seg: [s.hip, s.shoulder], f: [0.1, 0.55], off: -5, w: 8 }),
  shoulder: (s) => ({ seg: [s.hip, s.shoulder], f: [0.88, 1], off: 0, w: 14 }),
  upperArm: (s) => ({ seg: [s.armNear[0], s.armNear[1]], f: [0.1, 0.9], off: 0, w: W.upper }),
  foreArm: (s) => ({ seg: [s.armNear[1], s.armNear[2]], f: [0.1, 0.9], off: 0, w: W.fore }),
  thigh: (s) => ({ seg: [s.legNear[0], s.legNear[1]], f: [0.1, 0.9], off: 0, w: W.thigh }),
  glute: (s) => ({ seg: [s.legNear[0], s.legNear[1]], f: [0, 0.3], off: -4, w: 11 }),
  hamstring: (s) => ({ seg: [s.legNear[0], s.legNear[1]], f: [0.2, 0.85], off: -3, w: 8 }),
  calf: (s) => ({ seg: [s.legNear[1], s.legNear[2]], f: [0.15, 0.7], off: -2, w: 8 }),
};

const ARM_Z = new Set(["upperArm", "foreArm"]);
const LEG_Z = new Set(["thigh", "glute", "hamstring", "calf"]);

function figure(s, on = [], sec = []) {
  const limb = (pts, cls, ws, halo = 0) =>
    (halo ? limb(pts, "tq-halo", ws.map((w) => w + halo)) : "") +
    [line(pts[0], pts[1], ws[0], cls), line(pts[1], pts[2], ws[1], cls), pts[3] ? line(pts[2], pts[3], ws[2], cls) : ""].join("");
  const zone = (z, cls) => {
    const d = ZONES[z]?.(s);
    if (!d) return "";
    const [a, b] = part(d.seg[0], d.seg[1], d.f[0], d.f[1], d.off);
    return line(a, b, d.w, cls);
  };
  return [
    // lado lejano primero (más oscuro), luego tronco, luego lado cercano
    limb(s.legFar, "tq-far", [W.thigh, W.shin, W.foot]),
    limb(s.armFar, "tq-far", [W.upper, W.fore]),
    line(s.hip, s.shoulder, W.torso, "tq-body"),
    `<circle class="tq-body" cx="${r1(s.head[0])}" cy="${r1(s.head[1])}" r="${LEN.head}"/>`,
    line(s.shoulder, step(s.shoulder, Math.atan2(s.shoulder[1] - s.head[1], s.head[0] - s.shoulder[0]) * 180 / Math.PI, LEN.neck), 7, "tq-body"),
    ...sec.filter((z) => !ARM_Z.has(z) && !LEG_Z.has(z)).map((z) => zone(z, "tq-sec")),
    ...on.filter((z) => !ARM_Z.has(z) && !LEG_Z.has(z)).map((z) => zone(z, "tq-on")),
    limb(s.legNear, "tq-near", [W.thigh, W.shin, W.foot], 3),
    ...sec.filter((z) => LEG_Z.has(z)).map((z) => zone(z, "tq-sec")),
    ...on.filter((z) => LEG_Z.has(z)).map((z) => zone(z, "tq-on")),
    limb(s.armNear, "tq-near", [W.upper, W.fore], 3),
    ...sec.filter((z) => ARM_Z.has(z)).map((z) => zone(z, "tq-sec")),
    ...on.filter((z) => ARM_Z.has(z)).map((z) => zone(z, "tq-on")),
  ].join("");
}

// Material y entorno.
const props = {
  floor: (y) => `<line class="tq-floor" x1="4" y1="${y}" x2="196" y2="${y}"/>`,
  bench: (x0, x1, top, floor) =>
    `<rect class="tq-prop" x="${x0}" y="${top}" width="${x1 - x0}" height="7" rx="3"/>` +
    `<line class="tq-prop-l" x1="${x0 + 8}" y1="${top + 7}" x2="${x0 + 8}" y2="${floor}"/>` +
    `<line class="tq-prop-l" x1="${x1 - 8}" y1="${top + 7}" x2="${x1 - 8}" y2="${floor}"/>`,
  // Mancuerna vista de canto (el eje sale hacia la cámara): un disco.
  db: ([x, y]) => `<circle class="tq-db" cx="${r1(x)}" cy="${r1(y)}" r="7.5"/><circle class="tq-db-c" cx="${r1(x)}" cy="${r1(y)}" r="2.2"/>`,
};

const hand = (s) => s.armNear[2];

function arrow(from, to, bend = 0) {
  // Curva suave del punto inicial al final, con punta.
  const mx = (from[0] + to[0]) / 2, my = (from[1] + to[1]) / 2;
  const dx = to[0] - from[0], dy = to[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  const c = [mx - (dy / len) * bend, my + (dx / len) * bend];
  const ang = Math.atan2(to[1] - c[1], to[0] - c[0]);
  const hx = (o) => [to[0] - 7 * Math.cos(ang + o), to[1] - 7 * Math.sin(ang + o)];
  return `<path class="tq-arrow" d="M${pt(from)} Q${pt(c)} ${pt(to)}"/>` +
    `<path class="tq-arrow-h" d="M${pt(hx(0.5))} L${pt(to)} L${pt(hx(-0.5))}"/>`;
}

// ------------------------------- posturas -------------------------------
// Suelo en y = 140 salvo que se diga otra cosa. Mirando a la derecha.
// on = músculos principales (verde), sec = secundarios (verde suave).
// start/end: dos imágenes (la de "Final" lleva en tenue el brazo/pierna del
// inicio y la flecha del recorrido). hold: una sola imagen (isométricos y estiramientos).
const F = 140;
const STAND = { hip: [100, 71], torso: 90, head: 90, legNear: [-90, -90, 0], legFar: [-92, -88, 0] };
const SUPINE = { hip: [118, 128], torso: 180, head: 180 }; // tumbado boca arriba, cabeza a la izquierda
const KNEES_UP = { legNear: { to: [150, 133], bend: 1 }, legFar: { to: [146, 133], bend: 1 } };
const PRONE = { hip: [90, 128], torso: 0, head: 0, legNear: [180, 180, 200], legFar: [182, 180, 200] };

const pose = (...parts) => Object.assign({}, ...parts);
const hold = (spec) => ({ ...spec, holdOnly: true });

export const TECHNIQUE = {
  // ---------------- Empuje ----------------
  10: { // Press de pecho en suelo
    on: ["chest"], sec: ["upperArm", "shoulder"], db: true,
    start: pose(SUPINE, KNEES_UP, { armNear: [[-95, 0.28], 90], armFar: [[-85, 0.28], 90] }),
    end: pose(SUPINE, KNEES_UP, { armNear: [90, 90], armFar: [92, 90] }),
  },
  11: { // Aperturas en suelo: de arriba, los brazos se abren en arco hacia el suelo
    on: ["chest"], sec: ["shoulder"], db: true, bend: 18,
    start: pose(SUPINE, KNEES_UP, { armNear: [88, 92], armFar: [90, 92] }),
    end: pose(SUPINE, KNEES_UP, { armNear: [[-100, 0.15], [170, 0.25]], armFar: [[-80, 0.15], [170, 0.25]] }),
  },
  12: { // Press militar de pie
    on: ["shoulder"], sec: ["upperArm"], db: true,
    start: pose(STAND, { armNear: [-78, 96], armFar: [-82, 94] }),
    end: pose(STAND, { armNear: [88, 90], armFar: [90, 90] }),
  },
  13: { // Rompe cráneos: el antebrazo baja hacia la cabeza, el codo quieto
    on: ["upperArm"], db: true, bend: -14,
    start: pose(SUPINE, KNEES_UP, { armNear: [98, 96], armFar: [100, 96] }),
    end: pose(SUPINE, KNEES_UP, { armNear: [100, 172], armFar: [102, 172] }),
  },
  14: { // Flexiones: cuerpo en línea, el pecho baja hasta casi el suelo
    on: ["chest"], sec: ["upperArm", "shoulder", "abs"], mov: "shoulder",
    // cuerpo recto desde el tobillo (40, 133.6): inclinación 27,6° arriba y 8° abajo
    start: { hip: [98.5, 103], torso: 27.6, head: 30, armNear: [-90, -90], armFar: [-88, -90],
      legNear: [207.6, 207.6, 225], legFar: [207, 207.6, 225] },
    end: { hip: [105.4, 124.4], torso: 8, head: 14, armNear: { to: [135.7, 134], bend: -1 }, armFar: { to: [137, 134], bend: -1 },
      legNear: [188, 188, 225], legFar: [187.5, 188, 225] },
  },
  // ---------------- HIIT + core ----------------
  20: { // Sentadillas
    on: ["thigh", "glute"], sec: ["abs"], mov: "hip",
    start: pose(STAND, { armNear: [0, 0], armFar: [2, 0] }),
    end: { hip: [76, 100], torso: 58, head: 70, armNear: [5, 0], armFar: [7, 0],
      legNear: { to: [100, 135], bend: 1 }, legFar: { to: [98, 135], bend: 1 } },
  },
  21: hold({ // Wall sit: espalda en la pared, muslos paralelos al suelo
    on: ["thigh"], sec: ["glute"], wall: 52,
    pose: { hip: [64, 103], torso: 90, head: 90, armNear: [-72, -30], armFar: [-74, -32],
      legNear: { to: [98, 135], bend: 1 }, legFar: { to: [96, 135], bend: 1 } },
  }),
  22: { // Crunch con peso al pecho
    on: ["abs"], db: true, mov: "shoulder",
    start: pose(SUPINE, KNEES_UP, { armNear: { to: [88, 117], bend: 1 }, armFar: { to: [90, 117], bend: 1 } }),
    end: pose(SUPINE, KNEES_UP, { torso: 152, head: 140, armNear: { to: [94, 104], bend: 1 }, armFar: { to: [96, 104], bend: 1 } }),
  },
  23: { // Lumbares (superman): pecho y piernas se despegan del suelo
    on: ["lowBack"], sec: ["glute", "back"], mov: "shoulder",
    start: pose(PRONE, { armNear: [0, 0], armFar: [2, 0] }),
    end: pose(PRONE, { torso: 20, head: 26, armNear: [26, 22], armFar: [28, 22], legNear: [199, 190, 205], legFar: [201, 190, 205] }),
  },
  24: hold({ // Plancha sobre antebrazos
    on: ["abs"], sec: ["shoulder", "lowBack"],
    pose: { hip: [89, 121.7], torso: 13.4, head: 13, armNear: [-90, 0], armFar: [-88, 0],
      legNear: [193.4, 193.4, 260], legFar: [194, 193.4, 260] },
  }),
  // ---------------- Tracción ----------------
  30: { // Remo a una mano
    on: ["back"], sec: ["upperArm", "foreArm"], db: true, bend: -14, bench: [20, 120, 112],
    start: { hip: [68, 78], torso: 22, head: 25, armNear: [-86, -88], armFar: [-90, -90], legNear: [-78, -95, 0], legFar: [-100, 180, 180] },
    end: { hip: [68, 78], torso: 22, head: 25, armNear: [174, -88], armFar: [-90, -90], legNear: [-78, -95, 0], legFar: [-100, 180, 180] },
  },
  31: { // Peso muerto rumano: cadera atrás, espalda recta, rodillas casi estiradas
    on: ["hamstring", "glute"], sec: ["lowBack"], db: true, mov: "hand",
    start: pose(STAND, { armNear: [-88, -90], armFar: [-90, -90] }),
    end: { hip: [78, 76], torso: 18, head: 22, armNear: [-90, -90], armFar: [-92, -90],
      legNear: { to: [100, 135], bend: 1 }, legFar: { to: [98, 135], bend: 1 } },
  },
  32: { // Curl bíceps: el codo quieto pegado al cuerpo
    on: ["upperArm"], sec: ["foreArm"], db: true, bend: 16,
    start: pose(STAND, { armNear: [-88, -84], armFar: [-90, -86] }),
    end: pose(STAND, { armNear: [-88, 78], armFar: [-90, 76] }),
  },
  33: { // Curl martillo / concentrado (mismo recorrido, agarre neutro)
    on: ["upperArm", "foreArm"], db: true, bend: 16,
    start: pose(STAND, { armNear: [-88, -84], armFar: [-90, -86] }),
    end: pose(STAND, { armNear: [-88, 78], armFar: [-90, 76] }),
  },
  34: hold({ // Curl isométrico a 90°
    on: ["upperArm"], sec: ["foreArm"], db: true,
    pose: pose(STAND, { armNear: [-88, 2], armFar: [-90, 0] }),
  }),
  // ---------------- Piernas + core ----------------
  40: { // Sentadillas
    on: ["thigh", "glute"], sec: ["abs"], mov: "hip",
    start: pose(STAND, { armNear: [0, 0], armFar: [2, 0] }),
    end: { hip: [76, 100], torso: 58, head: 70, armNear: [5, 0], armFar: [7, 0],
      legNear: { to: [100, 135], bend: 1 }, legFar: { to: [98, 135], bend: 1 } },
  },
  41: { // Zancadas: paso largo, las dos rodillas a 90°
    on: ["thigh", "glute"], sec: ["hamstring"], mov: "hip",
    start: pose(STAND, { armNear: [-90, -90], armFar: [-92, -90] }),
    end: { hip: [100, 103], torso: 90, head: 90, armNear: [-90, -90], armFar: [-92, -90],
      legNear: { to: [134, 135], bend: 1 }, legFar: [-100, 175, 200] },
  },
  42: { // Puente de glúteo: hombros en el suelo, la cadera sube
    on: ["glute"], sec: ["hamstring", "lowBack"], mov: "hip",
    start: pose(SUPINE, { hip: [100, 128], armNear: [-2, 0], armFar: [0, 0],
      legNear: { to: [134, 133], bend: 1 }, legFar: { to: [130, 133], bend: 1 } }),
    end: { hip: [94.4, 107], torso: 210, head: 190, armNear: { to: [100, 130] }, armFar: { to: [102, 130] },
      legNear: { to: [134, 133], bend: 1 }, legFar: { to: [130, 133], bend: 1 } },
  },
  43: { // Crunch con peso al pecho
    on: ["abs"], db: true, mov: "shoulder",
    start: pose(SUPINE, KNEES_UP, { armNear: { to: [88, 117], bend: 1 }, armFar: { to: [90, 117], bend: 1 } }),
    end: pose(SUPINE, KNEES_UP, { torso: 152, head: 140, armNear: { to: [94, 104], bend: 1 }, armFar: { to: [96, 104], bend: 1 } }),
  },
  44: hold({ // Plancha
    on: ["abs"], sec: ["shoulder", "lowBack"],
    pose: { hip: [89, 121.7], torso: 13.4, head: 13, armNear: [-90, 0], armFar: [-88, 0],
      legNear: [193.4, 193.4, 260], legFar: [194, 193.4, 260] },
  }),
  // ---------------- Estiramientos ----------------
  15: hold({ on: ["chest"], sec: ["shoulder"], wall: 66, // pecho en el marco: el brazo atrás, apoyado
    pose: pose(STAND, { armNear: [180, 90], armFar: [-92, -90] }) }),
  16: hold({ on: ["shoulder"], // hombro cruzado: brazo estirado delante, la otra mano en el codo
    pose: pose(STAND, { armNear: [-4, 0], armFar: { to: [114, 34], bend: -1 } }) }),
  17: hold({ on: ["upperArm"], sec: ["shoulder"], // tríceps: mano detrás de la cabeza
    pose: pose(STAND, { armNear: [96, -116], armFar: { to: [99, 4], bend: 1 } }) }),
  18: hold({ on: ["back"], sec: ["lowBack"], // postura del niño
    pose: { hip: [70, 118], torso: -15, head: -22, armNear: [-8, 0], armFar: [-6, 0],
      legNear: [-40, 180, 180], legFar: [-38, 180, 180] } }),
  25: hold({ on: ["thigh"], // cuádriceps de pie: talón al glúteo
    pose: pose(STAND, { armNear: { to: [81, 84], bend: 1 }, armFar: [-92, -90], legNear: [-100, 135, 200] }) }),
  26: hold({ on: ["abs"], sec: ["lowBack"], // cobra
    pose: pose(PRONE, { hip: [78, 128], torso: 55, head: 70, armNear: { to: [122, 136], bend: 1 }, armFar: { to: [124, 136], bend: 1 } }) }),
  27: hold({ on: ["lowBack"], sec: ["glute"], // rodillas al pecho
    pose: pose(SUPINE, { armNear: { to: [96, 104], bend: 1 }, armFar: { to: [98, 104], bend: 1 },
      legNear: [132, -12, 70], legFar: [128, -12, 70] }) }),
  28: hold({ on: ["glute"], sec: ["hamstring"], // glúteo en figura 4
    pose: pose(SUPINE, { armNear: { to: [104, 98], bend: 1 }, armFar: { to: [106, 98], bend: 1 },
      legNear: [112, 0, 40], legFar: [104, -20, 0] }) }),
  35: hold({ on: ["back"], // dorsal con el brazo arriba
    pose: pose(STAND, { armNear: [96, 126], armFar: [92, 112] }) }),
  36: hold({ on: ["upperArm", "foreArm"], wall: 48, // bíceps y antebrazo en la pared, brazo atrás
    pose: pose(STAND, { armNear: [182, 180], armFar: [-92, -90] }) }),
  37: hold({ on: ["hamstring"], sec: ["lowBack"], // isquios sentado
    pose: { hip: [70, 128], torso: 38, head: 25, armNear: { to: [130, 122], bend: 1 }, armFar: { to: [132, 122], bend: 1 },
      legNear: [0, 0, 90], legFar: [1, 0, 90] } }),
  38: hold({ on: ["back"], sec: ["lowBack"], // postura del niño
    pose: { hip: [70, 118], torso: -15, head: -22, armNear: [-8, 0], armFar: [-6, 0],
      legNear: [-40, 180, 180], legFar: [-38, 180, 180] } }),
  45: hold({ on: ["thigh"], // cuádriceps de pie
    pose: pose(STAND, { armNear: { to: [81, 84], bend: 1 }, armFar: [-92, -90], legNear: [-100, 135, 200] }) }),
  46: hold({ on: ["hamstring"], sec: ["lowBack"], // isquios sentado
    pose: { hip: [70, 128], torso: 38, head: 25, armNear: { to: [130, 122], bend: 1 }, armFar: { to: [132, 122], bend: 1 },
      legNear: [0, 0, 90], legFar: [1, 0, 90] } }),
  47: hold({ on: ["glute"], sec: ["hamstring"], // glúteo en figura 4
    pose: pose(SUPINE, { armNear: { to: [104, 98], bend: 1 }, armFar: { to: [106, 98], bend: 1 },
      legNear: [112, 0, 40], legFar: [104, -20, 0] }) }),
  48: hold({ on: ["calf"], wallR: 152, // gemelo en la pared: pierna de atrás estirada, talón al suelo
    pose: { hip: [95, 76], torso: 68, head: 68, armNear: { to: [146, 44], bend: -1 }, armFar: { to: [146, 46], bend: -1 },
      legNear: { to: [62, 135], bend: -1, foot: 0 }, legFar: { to: [116, 135], bend: 1 } } }),
};

/** Encuadre común a todas las imágenes del ejercicio (inicio y final a la misma
 *  escala), con margen y proporción 4:3 y el suelo abajo. */
function frame(t) {
  const pts = [];
  for (const p of poses(t)) {
    const s = skeleton(p);
    pts.push(...[s.hip, s.shoulder, s.head, ...s.armNear, ...s.armFar, ...s.legNear, ...s.legFar].filter(Boolean));
  }
  if (t.bench) pts.push([t.bench[0], t.bench[2]], [t.bench[1], t.bench[2]]);
  if (t.wall != null) pts.push([t.wall - 6, 20]);
  if (t.wallR != null) pts.push([t.wallR + 6, 20]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const pad = 14;
  let x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad;
  let y0 = Math.min(...ys) - pad, y1 = Math.max(F + 4, Math.max(...ys) + pad);
  const w = x1 - x0, h = y1 - y0;
  const ratio = Math.min(4 / 3, Math.max(0.8, w / h)); // de pie: algo vertical; tumbado: apaisado
  if (w / h > ratio) y0 = y1 - w / ratio;
  else { const nw = h * ratio, cx = (x0 + x1) / 2; x0 = cx - nw / 2; x1 = cx + nw / 2; }
  return [x0, y0, x1 - x0, y1 - y0].map(r1);
}
const poses = (t) => (t.holdOnly ? [t.pose] : [t.start, t.end]);

/** Punto que "se mueve" en el ejercicio, para la flecha: mano (por defecto), cadera u hombro. */
const mover = (t, s) => (t.mov === "hip" ? s.hip : t.mov === "shoulder" ? s.shoulder : s.armNear[2]);

/** ¿Hay dibujo de técnica para este ejercicio? */
export const hasTechnique = (exId) => exId in TECHNIQUE;
/** "pair" → dos imágenes; "hold" → una. */
export const techniqueKind = (exId) => (TECHNIQUE[exId]?.holdOnly ? "hold" : "pair");

/** SVG de una postura. which: "start" | "end" | "hold". En "end" se ve en tenue
 *  el brazo del inicio y la flecha del recorrido. */
export function techniqueSVG(exId, which, { label = "" } = {}) {
  const t = TECHNIQUE[exId];
  if (!t) return "";
  const p = which === "hold" || t.holdOnly ? t.pose : t[which];
  const s = skeleton(p);
  const vb = frame(t);
  const ghost = which === "end" ? skeleton(t.start) : null;
  const title = which === "start" ? "inicio" : which === "end" ? "final" : "posición";
  const x0 = vb[0], x1 = r1(vb[0] + vb[2]);
  const parts = [
    t.wall != null ? `<rect class="tq-prop" x="${t.wall - 6}" y="${vb[1]}" width="6" height="${r1(F - vb[1])}"/>` : "",
    t.wallR != null ? `<rect class="tq-prop" x="${t.wallR}" y="${vb[1]}" width="6" height="${r1(F - vb[1])}"/>` : "",
    `<line class="tq-floor" x1="${x0}" y1="${F}" x2="${x1}" y2="${F}"/>`,
    t.bench ? props.bench(t.bench[0], t.bench[1], t.bench[2], F) : "",
    ghost && !t.mov ? `<g class="tq-ghost">${line(ghost.armNear[0], ghost.armNear[1], W.upper, "tq-near")}${line(ghost.armNear[1], ghost.armNear[2], W.fore, "tq-near")}${t.db ? props.db(hand(ghost)) : ""}</g>` : "",
    figure(s, t.on, t.sec),
    t.db ? props.db(hand(s)) : "",
    ghost ? arrow(mover(t, ghost), mover(t, s), t.bend ?? 0) : "",
  ];
  const aria = `${label ? label + ": " : ""}posición de ${title}`;
  return `<svg class="tq" viewBox="${vb.join(" ")}" role="img" aria-label="${aria.replace(/"/g, "&quot;")}">${parts.join("")}</svg>`;
}
