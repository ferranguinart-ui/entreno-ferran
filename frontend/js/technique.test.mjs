import test from "node:test";
import assert from "node:assert/strict";
import { TECHNIQUE, techniqueSVG, techniqueKind, hasTechnique, skeleton } from "./technique.js";

const MAIN = [10, 11, 12, 13, 14, 20, 21, 22, 23, 24, 30, 31, 32, 33, 34, 40, 41, 42, 43, 44];
const STRETCH = [15, 16, 17, 18, 25, 26, 27, 28, 35, 36, 37, 38, 45, 46, 47, 48];

test("técnica: todos los ejercicios del plan y los estiramientos tienen dibujo", () => {
  for (const id of [...MAIN, ...STRETCH]) assert.ok(hasTechnique(id), `falta ${id}`);
  assert.equal(hasTechnique(1), false); // calentamiento: no
});

test("técnica: SVG válido, sin NaN, con etiqueta accesible", () => {
  for (const id of Object.keys(TECHNIQUE).map(Number)) {
    const whichs = techniqueKind(id) === "hold" ? ["hold"] : ["start", "end"];
    for (const w of whichs) {
      const svg = techniqueSVG(id, w, { label: 'Ej "x"' });
      assert.match(svg, /^<svg class="tq" viewBox="[-\d.]+ [-\d.]+ [\d.]+ [\d.]+" role="img"/);
      assert.doesNotMatch(svg, /NaN|undefined/);
      assert.match(svg, /aria-label="Ej &quot;x&quot;: posición de /);
    }
  }
});

test("técnica: isométricos y estiramientos = una postura; el resto, inicio y final con flecha", () => {
  assert.equal(techniqueKind(24), "hold");
  assert.equal(techniqueKind(15), "hold");
  assert.equal(techniqueKind(10), "pair");
  assert.match(techniqueSVG(10, "end"), /tq-arrow/);
  assert.doesNotMatch(techniqueSVG(10, "start"), /tq-arrow/);
});

test("técnica: la cinemática inversa lleva la mano al punto pedido", () => {
  const s = skeleton({ hip: [100, 71], torso: 90, armNear: { to: [120, 60] }, legNear: [-90, -90, 0] });
  const h = s.armNear[2];
  assert.ok(Math.hypot(h[0] - 120, h[1] - 60) < 0.5);
});
