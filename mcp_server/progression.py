"""Discos, pesos montables y doble progresión. Port 1:1 de frontend/js/plates.js
(la app y el MCP deben decir lo mismo; tests/test_progression.py lo comprueba
contra el JS). Lógica pura, sin BD.

Material de Ferran: barras de plástico (≈0 kg) y una barra que une las dos
mancuernas. Los discos van siempre iguales a cada lado.
  pair       = las dos mancuernas cargadas igual (el peso es POR mancuerna)
  single     = una sola mancuerna con todos los discos
  bar        = la barra (dos mancuernas unidas): todos los discos en una carga
  bodyweight = sin peso
"""
from __future__ import annotations

from functools import lru_cache
from itertools import product

JUMP_MARGIN = 4  # reps por encima del máximo que justifican subir tras una sola sesión
PLATES = [(2.5, 4), (2.0, 4), (1.5, 4), (1.25, 5)]  # (kg, unidades)


def r2(v: float) -> float:
    return round(v * 100) / 100


def _sides(eq: str | None) -> int:
    return 4 if eq == "pair" else 2 if eq in ("single", "bar") else 0


@lru_cache(maxsize=None)
def _combos(eq: str | None) -> tuple:
    sides = _sides(eq)
    if not sides:
        return ()
    ranges = [range(n // sides + 1) for _, n in PLATES]
    out = []
    for counts in product(*ranges):
        side = sum(c * kg for c, (kg, _) in zip(counts, PLATES))
        per_side = tuple((kg, c) for c, (kg, _) in zip(counts, PLATES) if c)
        out.append((r2(side * 2), per_side, sum(counts)))
    return tuple(out)


def load_options(eq: str | None) -> list[float]:
    """Pesos montables (kg por mancuerna en "pair", por carga en "single"/"bar")."""
    return sorted({c[0] for c in _combos(eq)})


def plates_for(kg: float, eq: str | None) -> list[tuple[float, int]] | None:
    """Discos por lado [(kg, unidades)] con el mínimo de piezas; None si no se puede."""
    hits = [c for c in _combos(eq) if c[0] == r2(kg)]
    if not hits:
        return None
    return list(min(hits, key=lambda c: c[2])[1])


def _es(v: float) -> str:
    return (str(int(v)) if float(v).is_integer() else str(v)).replace(".", ",")


def plates_text(kg: float, eq: str | None) -> str:
    """"por lado: 2,5 + 1,5" · "sin discos" · "" si no se puede montar."""
    p = plates_for(kg, eq)
    if p is None:
        return ""
    if not p:
        return "sin discos"
    return "por lado: " + " + ".join(f"{c} × {_es(k)}" if c > 1 else _es(k) for k, c in p)


def step_load(kg: float | None, eq: str | None, direction: int) -> float | None:
    """Siguiente (1) o anterior (-1) peso montable; topa en los extremos."""
    o = load_options(eq)
    if not o:
        return None
    if kg is None:
        return next((v for v in o if v > 0), o[0]) if direction > 0 else o[0]
    if direction > 0:
        return next((v for v in o if v > r2(kg)), o[-1])
    return next((v for v in reversed(o) if v < r2(kg)), o[0])


def _all_at_least(reps: list[int], n: int) -> bool:
    return bool(reps) and all(r >= n for r in reps)


def _any_below(reps: list[int], n: int) -> bool:
    return any(r < n for r in reps)


def progression(history: list[dict], ex: dict) -> dict:
    """Doble progresión. `history`: sesiones de MÁS RECIENTE a más antigua,
    cada una {kg, reps:[por ronda], deload}. El deload no cuenta.
    → {action: start|hold|up|down, kg, from?}"""
    eq = ex.get("equipment")
    if eq == "bodyweight" or not eq:
        return {"action": "hold", "kg": None}
    real = [h for h in history if not h.get("deload")]
    if not real:
        return {"action": "start", "kg": history[0].get("kg") if history else None}
    kg = real[0].get("kg")
    if kg is None:
        return {"action": "start", "kg": None}
    lo, hi = ex.get("rep_min"), ex.get("rep_max")
    if lo is None or hi is None:
        return {"action": "hold", "kg": kg}
    # Muy sobrado (máximo + JUMP_MARGIN en todas las rondas): subir ya, sin esperar otra sesión.
    if len(real[0]["reps"]) >= 2 and _all_at_least(real[0]["reps"], hi + JUMP_MARGIN):
        up = step_load(kg, eq, 1)
        if up > kg:
            return {"action": "up", "kg": up, "from": kg}
    if len(real) < 2:
        return {"action": "hold", "kg": kg}
    a, b = real[0], real[1]
    same_kg = b.get("kg") is not None and r2(a["kg"]) == r2(b["kg"])
    if same_kg and _all_at_least(a["reps"], hi) and _all_at_least(b["reps"], hi):
        up = step_load(kg, eq, 1)
        if up > kg:
            return {"action": "up", "kg": up, "from": kg}
    if same_kg and _any_below(a["reps"], lo) and _any_below(b["reps"], lo):
        down = step_load(kg, eq, -1)
        if down < kg:
            return {"action": "down", "kg": down, "from": kg}
    return {"action": "hold", "kg": kg}


# Peso de partida sin historial con kg (igual que starterKg en plates.js).
STARTER = {30: 10, 31: 12, 32: 8, 33: 5, 34: 6}
STARTER_EQ = {"pair": 5, "single": 8, "bar": 8}


def starter_kg(ex: dict) -> float | None:
    eq = ex.get("equipment")
    if not eq or eq == "bodyweight":
        return None
    want = STARTER.get(ex.get("id"), STARTER_EQ.get(eq))
    return min(load_options(eq), key=lambda v: (abs(v - want), v))
