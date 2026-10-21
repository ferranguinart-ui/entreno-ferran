// Mapa muscular: de los textos del plan ("Pectoral", "Tríceps, hombro anterior")
// a zonas del cuerpo, y un SVG propio (delante + detrás) con el estilo de la app.
// Puro (sin DOM): se testea en Node. El color lo pone el CSS (.mz.on / .mz.sec).

export const REGIONS = [
  "chest", "deltsFront", "deltsRear", "biceps", "triceps", "forearms", "abs", "obliques",
  "traps", "lats", "lowerBack", "glutes", "quads", "hamstrings", "calves",
];

const NAMES = {
  chest: "pecho", deltsFront: "hombro (delante)", deltsRear: "hombro (detrás)", biceps: "bíceps",
  triceps: "tríceps", forearms: "antebrazo", abs: "abdomen", obliques: "oblicuos", traps: "trapecio",
  lats: "dorsal", lowerBack: "lumbar", glutes: "glúteo", quads: "cuádriceps", hamstrings: "femoral",
  calves: "gemelo",
};

// Primera regla que encaja en cada trozo del texto (el orden importa:
// "hombro posterior" antes que "hombro").
const RULES = [
  [/cuerpo completo/, REGIONS],
  [/pectoral|pecho/, ["chest"]],
  [/hombro posterior|deltoides posterior/, ["deltsRear"]],
  [/hombro anterior|deltoides anterior/, ["deltsFront"]],
  [/hombro|deltoides/, ["deltsFront", "deltsRear"]],
  [/triceps/, ["triceps"]],
  [/biceps/, ["biceps"]],
  [/braquial|antebrazo/, ["forearms"]],
  [/dorsal|espalda/, ["lats"]],
  [/trapecio/, ["traps"]],
  [/lumbar/, ["lowerBack"]],
  [/gluteo/, ["glutes"]],
  [/cuadriceps/, ["quads"]],
  [/femoral|isquio/, ["hamstrings"]],
  [/gemelo|pantorrilla/, ["calves"]],
  [/oblicuo/, ["obliques"]],
  [/recto abdominal|abdominal|abdomen/, ["abs"]],
  [/core/, ["abs", "obliques", "lowerBack"]],
];

const escAttr = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

function parse(text) {
  const out = new Set();
  for (const part of norm(text).split(/[,/]| y /)) {
    const rule = RULES.find(([re]) => re.test(part));
    if (rule) rule[1].forEach((r) => out.add(r));
  }
  return out;
}

/** {primary:Set, secondary:Set} de zonas; lo principal no se repite como secundario. */
export function musclesFor(primaryText, secondaryText) {
  const primary = parse(primaryText);
  const secondary = parse(secondaryText);
  for (const r of primary) secondary.delete(r);
  return { primary, secondary };
}

// ------------------------------- dibujo -------------------------------
// Figura en un marco de 100×200, centro x=50. Solo la mitad izquierda;
// la derecha es su espejo. [zona | null (neutro), path]
const FRONT = [
  [null, "M50,3 C43,3 40.5,8 40.5,14 C40.5,21 44,26 50,26 Z"], // cabeza
  [null, "M45,25 L50,26 L50,32 L44,31 Z"], // cuello
  ["traps", "M44,28.5 Q39,31 32.5,33.5 Q39,34 44.5,32.5 Z"],
  ["deltsFront", "M32,34 Q24.5,34.5 22.5,45 Q24.5,49.5 28.5,47.5 Q30.5,40 36.5,36 Z"],
  ["chest", "M50,34.5 L38,35.5 Q31.5,39.5 31,47.5 Q36,55 50,53.5 Z"],
  ["biceps", "M22.3,48.5 Q19.2,56 19.8,65.5 Q23,69 27,65.5 Q28.8,57.5 28.6,49.2 Z"],
  ["forearms", "M19.6,68.5 Q15.5,78 15.6,90 L20.6,91 Q25,80.5 27,68.4 Z"],
  [null, "M15.4,92.2 Q14.6,98.5 18,100 Q21.4,98.4 20.9,92.6 Z"], // mano
  ["abs", "M50,55.6 L43.4,56.4 Q41.6,72 43.8,87.5 L50,89.5 Z"],
  ["obliques", "M42.2,56.8 Q35.4,60.5 35.2,72 Q36.8,82.5 42.8,87.2 Q40.2,72 42.2,56.8 Z"],
  [null, "M43,88.5 Q37.6,92 35.8,98.5 L50,101 L50,90.4 Z"], // cadera
  ["quads", "M35.6,99.6 Q31,112 32,128 Q33.8,140 38,146.5 L46.2,146.6 Q50,125 50,102.5 Z"],
  [null, "M38.4,148 Q42.2,145.6 46,148 Q46.6,152.8 42.2,153.6 Q37.8,152.8 38.4,148 Z"], // rodilla
  ["calves", "M38.4,155 Q35.8,170 38.8,186 L44.4,186 Q47.4,170 46,155 Z"],
  [null, "M38.4,188 L44.6,188 L46.6,193.5 L35.6,193.5 Z"], // pie
];
const BACK = [
  [null, "M50,3 C43,3 40.5,8 40.5,14 C40.5,21 44,26 50,26 Z"],
  [null, "M45,25 L50,26 L50,30 L44.6,29.5 Z"],
  ["traps", "M50,29 L44.4,29.2 Q38.6,31.4 32.6,34 Q42,37 50,52 Z"],
  ["deltsRear", "M32,34.6 Q24.5,35 22.5,45 Q24.5,49.5 28.5,47.5 Q30.5,40.5 36.5,37 Z"],
  ["triceps", "M22.3,48.5 Q19.2,56 19.8,65.5 Q23,69 27,65.5 Q28.8,57.5 28.6,49.2 Z"],
  ["forearms", "M19.6,68.5 Q15.5,78 15.6,90 L20.6,91 Q25,80.5 27,68.4 Z"],
  [null, "M15.4,92.2 Q14.6,98.5 18,100 Q21.4,98.4 20.9,92.6 Z"],
  ["lats", "M37.2,38.4 Q31.4,42 32,50 Q33.4,62 41.8,70.4 L50,71.6 L50,53.6 Q43,43.4 37.2,38.4 Z"],
  ["lowerBack", "M50,72.8 L41.6,71.6 Q40.8,80.6 43.6,87.8 L50,89.6 Z"],
  ["glutes", "M50,90.6 L43.2,88.8 Q35.2,92.2 35,101.6 Q37.6,110.8 50,109.2 Z"],
  ["hamstrings", "M35.4,107.6 Q31.8,124 34.8,144.4 L46.4,146 Q50,127 50,111 Z"],
  [null, "M38.4,148 Q42.2,145.6 46,148 Q46.6,152.8 42.2,153.6 Q37.8,152.8 38.4,148 Z"],
  ["calves", "M38.2,155 Q34,166.4 37,178.6 Q40.8,186.4 45.2,184.2 Q48.4,170 46.2,155 Z"],
  [null, "M38.4,188 L44.6,188 L46.6,193.5 L35.6,193.5 Z"],
];
// Líneas de los abdominales (marcan la zona a simple vista).
const ABS_LINES = "M44,64 L56,64 M43.6,72 L56.4,72 M43.8,80 L56.2,80 M50,56 L50,89";

function half(parts, state) {
  return parts
    .map(([m, d]) => {
      if (!m) return `<path class="nb" d="${d}"/>`;
      const cls = state.primary.has(m) ? "mz on" : state.secondary.has(m) ? "mz sec" : "mz";
      return `<path data-m="${m}" class="${cls}" d="${d}"/>`;
    })
    .join("");
}

function figure(parts, state, x, title, extra = "") {
  const h = half(parts, state);
  return `<g transform="translate(${x},2) scale(0.95)">
    <g>${h}</g><g transform="translate(100,0) scale(-1,1)">${h}</g>${extra}
  </g>
  <text class="mlbl" x="${x + 47.5}" y="198" text-anchor="middle">${title}</text>`;
}

const inView = (parts) => new Set(parts.map(([m]) => m).filter(Boolean));
const FRONT_SET = inView(FRONT);
const BACK_SET = inView(BACK);
// Zonas que salen en las dos vistas: no deciden cuál enseñar.
const SHARED = new Set([...FRONT_SET].filter((m) => BACK_SET.has(m)));

/** Vista donde trabaja lo principal ("front" | "back"); empate → delante. */
export function bestView(state) {
  const score = (set) => [...state.primary].filter((m) => set.has(m) && !SHARED.has(m)).length;
  return score(BACK_SET) > score(FRONT_SET) ? "back" : "front";
}

/** SVG del mapa muscular. view: "both" (delante + detrás), "front" o "back".
 *  `label` = nombre del ejercicio (accesibilidad). */
export function bodyMapSVG(state, { label = "", view = "both" } = {}) {
  const list = (set) => [...set].map((r) => NAMES[r]).join(", ");
  const desc = [
    state.primary.size ? `principal ${list(state.primary)}` : "",
    state.secondary.size ? `secundario ${list(state.secondary)}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  const aria = label ? `${label}: ${desc || "sin músculos indicados"}` : desc;
  const absLines = `<path class="mline" d="${ABS_LINES}"/>`;
  const open = (w) => `<svg class="bodymap" viewBox="0 0 ${w} 200" role="img" aria-label="${escAttr(aria)}">`;
  if (view === "front") return `${open(110)}${figure(FRONT, state, 5, "Delante", absLines)}</svg>`;
  if (view === "back") return `${open(110)}${figure(BACK, state, 5, "Detrás")}</svg>`;
  return `${open(220)}${figure(FRONT, state, 6, "Delante", absLines)}${figure(BACK, state, 119, "Detrás")}</svg>`;
}
