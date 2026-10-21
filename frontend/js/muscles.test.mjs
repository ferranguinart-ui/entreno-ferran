import test from "node:test";
import assert from "node:assert/strict";
import { musclesFor, REGIONS, bodyMapSVG } from "./muscles.js";

const ids = (set) => [...set].sort();

test("musclesFor: textos del plan → zonas del cuerpo (principal y secundario)", () => {
  const m = musclesFor("Pectoral", "Tríceps, hombro anterior");
  assert.deepEqual(ids(m.primary), ["chest"]);
  assert.deepEqual(ids(m.secondary), ["deltsFront", "triceps"]);
});

test("musclesFor: 'hombro / deltoides' = las dos caras del hombro", () => {
  assert.deepEqual(ids(musclesFor("Hombro / deltoides").primary), ["deltsFront", "deltsRear"]);
  assert.deepEqual(ids(musclesFor("Movilidad de hombro").primary), ["deltsFront", "deltsRear"]);
});

test("musclesFor: 'hombro posterior' no enciende la parte delantera", () => {
  assert.deepEqual(ids(musclesFor("Dorsal ancho", "Bíceps, hombro posterior").secondary), ["biceps", "deltsRear"]);
});

test("musclesFor: core, lumbar, femoral, glúteo, braquial", () => {
  assert.deepEqual(ids(musclesFor("Core completo (isométrico)").primary), ["abs", "lowerBack", "obliques"]);
  assert.deepEqual(ids(musclesFor("Zona lumbar", "Glúteo").primary), ["lowerBack"]);
  assert.deepEqual(ids(musclesFor("Femoral, glúteo").primary), ["glutes", "hamstrings"]);
  assert.deepEqual(ids(musclesFor("Bíceps, braquial", "Antebrazo").primary), ["biceps", "forearms"]);
  assert.deepEqual(ids(musclesFor("Cuádriceps, glúteo (unilateral)", "Equilibrio / core").secondary), ["abs", "lowerBack", "obliques"]);
});

test("musclesFor: lo principal no se repite como secundario", () => {
  const m = musclesFor("Pectoral, tríceps", "Core, hombro, tríceps");
  assert.ok(m.primary.has("triceps"));
  assert.ok(!m.secondary.has("triceps"));
});

test("musclesFor: cuerpo completo enciende todo; sin texto, nada", () => {
  assert.equal(musclesFor("Cardiovascular general, cuerpo completo").primary.size, REGIONS.length);
  assert.equal(musclesFor(null, null).primary.size, 0);
  assert.equal(musclesFor("", "").secondary.size, 0);
});

test("bodyMapSVG: dos vistas, cada zona marcada con su estado", () => {
  const svg = bodyMapSVG(musclesFor("Pectoral", "Tríceps"));
  assert.match(svg, /^<svg[^>]+viewBox="0 0 220 200"/);
  assert.match(svg, /data-m="chest"[^>]*class="mz on"/);
  assert.match(svg, /data-m="triceps"[^>]*class="mz sec"/);
  assert.match(svg, /data-m="quads"[^>]*class="mz"/);
  assert.match(svg, /Delante/);
  assert.match(svg, /Detrás/);
});

test("bodyMapSVG: accesible (role img + etiqueta con los músculos)", () => {
  const svg = bodyMapSVG(musclesFor("Pectoral", "Tríceps"), { label: "Press de pecho" });
  assert.match(svg, /role="img"/);
  assert.match(svg, /aria-label="Press de pecho: principal pecho; secundario tríceps"/);
});

import { bestView } from "./muscles.js";

test("bestView: la vista donde está lo principal (empate → delante)", () => {
  assert.equal(bestView(musclesFor("Pectoral", "Tríceps")), "front");
  assert.equal(bestView(musclesFor("Dorsal ancho", "Bíceps")), "back");
  assert.equal(bestView(musclesFor("Femoral, glúteo")), "back");
  assert.equal(bestView(musclesFor("Cuádriceps, glúteo")), "front");
  assert.equal(bestView(musclesFor("Tríceps (cabeza larga)")), "back");
});

test("bodyMapSVG view: una sola figura, más estrecha", () => {
  const svg = bodyMapSVG(musclesFor("Dorsal ancho"), { view: "back" });
  assert.match(svg, /viewBox="0 0 110 200"/);
  assert.match(svg, /data-m="lats"[^>]*class="mz on"/);
  assert.doesNotMatch(svg, /data-m="chest"/);
});

test("bodyMapSVG: el nombre del ejercicio se escapa en el aria-label", () => {
  const svg = bodyMapSVG(musclesFor("Pectoral"), { label: 'Press "pesado" <x>' });
  assert.match(svg, /aria-label="Press &quot;pesado&quot; &lt;x&gt;: principal pecho"/);
});
