"""La regla del MCP es la de la app: mismos casos que plates.test.mjs y,
si hay node, comparación directa contra frontend/js/plates.js."""
import json
import pathlib
import random
import shutil
import subprocess

import pytest

from progression import load_options, plates_for, plates_text, progression, step_load

ROOT = pathlib.Path(__file__).resolve().parents[2]
EX = {"equipment": "pair", "rep_min": 10, "rep_max": 14}


def ses(kg, reps, deload=False):
    return {"kg": kg, "reps": reps, "deload": deload}


def test_load_options():
    o = load_options("pair")
    assert len(o) == 16 and o[:6] == [0, 2.5, 3, 4, 5, 5.5] and o[-1] == 14.5
    assert load_options("single")[-1] == 29 and load_options("bar") == load_options("single")
    assert load_options("bodyweight") == [] and load_options(None) == []


def test_plates():
    assert plates_for(8, "pair") == [(2.5, 1), (1.5, 1)]
    assert plates_for(6, "pair") is None
    assert plates_text(8, "pair") == "por lado: 2,5 + 1,5"
    assert plates_text(10, "single") == "por lado: 2 × 2,5"
    assert plates_text(0, "pair") == "sin discos"
    assert plates_text(6, "pair") == ""


def test_step_load():
    assert step_load(8, "pair", 1) == 9
    assert step_load(8, "pair", -1) == 7.5
    assert step_load(14.5, "pair", 1) == 14.5
    assert step_load(6, "pair", 1) == 6.5
    assert step_load(None, "pair", 1) == 2.5


def test_progression_cases():
    assert progression([], EX) == {"action": "start", "kg": None}
    assert progression([ses(8, [14, 14, 15]), ses(8, [14, 15, 14])], EX) == {"action": "up", "kg": 9, "from": 8}
    assert progression([ses(8, [14, 14, 14]), ses(8, [13, 12, 12])], EX) == {"action": "hold", "kg": 8}
    assert progression([ses(9, [9, 8, 8]), ses(9, [9, 9, 8])], EX) == {"action": "down", "kg": 8, "from": 9}
    assert progression([ses(6.5, [10, 10], True), ses(8, [14, 14]), ses(8, [15, 14])], EX) == {"action": "up", "kg": 9, "from": 8}
    assert progression([ses(8, [14, 14]), ses(7.5, [14, 14])], EX) == {"action": "hold", "kg": 8}
    assert progression([ses(6.5, [12], True)], EX) == {"action": "start", "kg": 6.5}
    assert progression([ses(None, [20])], {"equipment": "bodyweight"}) == {"action": "hold", "kg": None}


@pytest.mark.skipif(not shutil.which("node"), reason="sin node")
def test_parity_with_app_js(tmp_path):
    rnd = random.Random(7)
    cases = []
    for _ in range(1500):
        eq = rnd.choice(["pair", "single", "bar"])
        opts = load_options(eq)
        lo = rnd.choice([10, 12])
        hi = lo + 4
        same = rnd.choice(opts)  # a menudo el mismo kg: así se ejercitan subir y bajar
        hist = [
            {"kg": same if rnd.random() < 0.6 else rnd.choice(opts + [None]), "reps": [rnd.randint(*rnd.choice([(lo - 3, hi + 1), (hi, hi + 1)])) for _ in range(rnd.randint(0, 4))],
             "deload": rnd.random() < 0.15}
            for _ in range(rnd.randint(0, 4))
        ]
        cases.append({"hist": hist, "ex": {"equipment": eq, "rep_min": lo, "rep_max": hi}, "kg": rnd.choice(opts + [6, 7.25])})
    (tmp_path / "cases.json").write_text(json.dumps(cases))
    script = f"""
      import {{ progression, platesText }} from "{(ROOT / 'frontend/js/plates.js').as_uri()}";
      import fs from "node:fs";
      const cases = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      console.log(JSON.stringify(cases.map(c => ({{p: progression(c.hist, c.ex), t: platesText(c.kg, c.ex.equipment)}}))));
    """
    out = subprocess.run(["node", "--input-type=module", "-e", script, str(tmp_path / "cases.json")],
                         capture_output=True, text=True, check=True).stdout
    js = json.loads(out)
    for c, j in zip(cases, js):
        assert progression(c["hist"], c["ex"]) == j["p"], c
        assert plates_text(c["kg"], c["ex"]["equipment"]) == j["t"], c


def test_subida_rapida_muy_por_encima():
    assert progression([ses(8, [24, 23, 18])], EX) == {"action": "up", "kg": 9, "from": 8}
    assert progression([ses(8, [24, 23, 17])], EX) == {"action": "hold", "kg": 8}


def test_subida_rapida_necesita_dos_rondas():
    assert progression([ses(8, [24])], EX) == {"action": "hold", "kg": 8}
