import test from "node:test";
import assert from "node:assert/strict";
import { dialText, ringFraction, changedIndices, beatAt } from "./fx.js";

test("dialText: menos de 60 s, solo segundos", () => {
  assert.equal(dialText(40), "40");
  assert.equal(dialText(5), "5");
  assert.equal(dialText(59), "59");
  assert.equal(dialText(0), "0");
});

test("dialText: 60 s o más, m:ss sin cero inicial", () => {
  assert.equal(dialText(60), "1:00");
  assert.equal(dialText(65), "1:05");
  assert.equal(dialText(600), "10:00");
});

test("dialText: valores raros", () => {
  assert.equal(dialText(-3), "0");
  assert.equal(dialText(12.7), "12");
  assert.equal(dialText(undefined), "0");
});

test("ringFraction: fracción restante del paso, acotada a [0,1]", () => {
  assert.equal(ringFraction(40000, 40), 1);
  assert.equal(ringFraction(20000, 40), 0.5);
  assert.equal(ringFraction(0, 40), 0);
  assert.equal(ringFraction(-50, 40), 0);
  assert.equal(ringFraction(99999, 40), 1);
  assert.equal(ringFraction(1000, 0), 0);
});

test("changedIndices: posiciones que cambian (y todas si cambia la longitud)", () => {
  assert.deepEqual(changedIndices("40", "39"), [0, 1]);
  assert.deepEqual(changedIndices("39", "38"), [1]);
  assert.deepEqual(changedIndices("38", "38"), []);
  assert.deepEqual(changedIndices("10", "9"), [0]);
  assert.deepEqual(changedIndices("1:00", "59"), [0, 1]);
  assert.deepEqual(changedIndices("", "40"), [0, 1]);
});

test("beatAt: late al cruzar 3, 2 y 1 (igual que el pitido)", () => {
  assert.equal(beatAt(4, 3), true);
  assert.equal(beatAt(3, 2), true);
  assert.equal(beatAt(2, 1), true);
  assert.equal(beatAt(5, 4), false);
  assert.equal(beatAt(3, 3), false);
  assert.equal(beatAt(null, 3), false);
  assert.equal(beatAt(1, 0), false);
});
