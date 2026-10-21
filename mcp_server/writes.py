"""Escrituras del MCP (lo que Ferran le dicta a Claude). Validan en el servidor y
devuelven el registro guardado completo, con su id. Errores = UserError legible."""
from __future__ import annotations

import uuid
from datetime import date

import db
from progression import load_options
from queries import (
    UserError, measurement_out, norm, parse_date, resolve_day, session_by_id, today, user_id,
)

MIN_DATE = date(2026, 1, 1)
WEIGHT_RANGE = (60, 95)      # kg corporales
REPS_RANGE = (0, 100)
MAX_ROUNDS = 10
DURATION_RANGE = (1, 300)    # minutos

WEIGHT_FIELDS = {"date", "weight_kg", "standard_conditions", "note"}
SESSION_FIELDS = {"date", "deload", "duration_min", "rounds", "note", "exercises"}


# ------------------------------- validación ----------------------------------
def check_date(s: str | None, field: str = "date") -> date:
    d = parse_date(s, field)
    if d is None:
        raise UserError(f"{field} es obligatoria (YYYY-MM-DD).")
    if d > today():
        raise UserError(f"{field} {d} es futura; hoy es {today()} (Europe/Madrid).")
    if d < MIN_DATE:
        raise UserError(f"{field} {d} es anterior a {MIN_DATE}; no se aceptan fechas tan antiguas.")
    return d


def check_weight(v) -> float:
    try:
        kg = float(v)
    except (TypeError, ValueError):
        raise UserError(f"weight_kg debe ser un número en kg, no '{v}'.")
    lo, hi = WEIGHT_RANGE
    if not lo <= kg <= hi:
        raise UserError(f"Peso {kg} kg fuera de rango ({lo}–{hi} kg). ¿Se ha entendido bien el número?")
    return round(kg, 1)


def check_uuid(s: str, what: str) -> str:
    try:
        return str(uuid.UUID(str(s)))
    except ValueError:
        raise UserError(f"id de {what} no válido: '{s}'. Usa el id que devuelven get_measurements/get_sessions.")


def _es(v: float) -> str:
    return (str(int(v)) if float(v).is_integer() else str(v)).replace(".", ",")


def check_set(ex: dict, i: int, st: dict) -> tuple[int | None, float | None]:
    """→ (reps, kg) de una ronda, validados contra el material del ejercicio."""
    where = f"{ex['name']} · ronda {i}"
    reps, kg = st.get("reps"), st.get("kg")
    if reps is None and kg is None:
        raise UserError(f"{where}: falta reps o kg.")
    try:
        reps = None if reps is None else float(reps)
        kg = None if kg is None else float(kg)
    except (TypeError, ValueError):
        raise UserError(f"{where}: reps y kg deben ser números.")
    if reps is not None:
        if not reps.is_integer():
            raise UserError(f"{where}: reps debe ser un número entero, no '{reps}'.")
        reps = int(reps)
        lo, hi = REPS_RANGE
        if not lo <= reps <= hi:
            raise UserError(f"{where}: {reps} reps fuera de rango ({lo}–{hi}).")
    eq = ex["equipment"]
    if kg is not None:
        if eq == "bodyweight" or not eq:
            if kg != 0:
                raise UserError(f"{where}: es de peso corporal, no lleva kg (omite kg).")
            kg = None
        else:
            opts = load_options(eq)
            if round(kg, 2) not in opts:
                below = [o for o in opts if o < kg]
                above = [o for o in opts if o > kg]
                near = " o ".join(_es(o) for o in ([below[-1]] if below else []) + ([above[0]] if above else []))
                per = " por mancuerna" if eq == "pair" else ""
                raise UserError(
                    f"{where}: {_es(kg)} kg{per} no se puede montar con los discos (2,5 / 2 / 1,5 / 1,25, "
                    f"iguales a cada lado; las barras no suman). Lo más cercano: {near} kg."
                )
    return reps, kg


async def _day_exercises(day_id: int) -> list[dict]:
    return await db.fetch(
        "select * from exercises where day_id = %s and block <> 'warmup' order by block = 'remate', sort_order",
        day_id,
    )


def match_exercise(name: str, exs: list[dict], day_name: str) -> dict:
    """Nombre tolerante a tildes y mayúsculas; acepta un trozo si solo encaja con uno."""
    q = norm(name)
    hits = [e for e in exs if norm(e["name"]) == q] or [e for e in exs if q and q in norm(e["name"])]
    if len(hits) != 1:
        valid = ", ".join(e["name"] for e in exs) or "(este día no tiene ejercicios fijos)"
        raise UserError(f"Ejercicio '{name}' no encontrado en {day_name}. Válidos: {valid}.")
    return hits[0]


def parse_exercises(items, exs: list[dict], day_name: str) -> list[tuple[dict, list[tuple]]]:
    out, seen = [], set()
    for it in items or []:
        it = it if isinstance(it, dict) else it.model_dump()
        ex = match_exercise(it.get("name", ""), exs, day_name)
        if ex["id"] in seen:
            raise UserError(f"{ex['name']} aparece dos veces; junta sus rondas en una sola entrada.")
        seen.add(ex["id"])
        sets = it.get("sets") or []
        if not sets:
            raise UserError(f"{ex['name']}: sin rondas (sets).")
        if len(sets) > MAX_ROUNDS:
            raise UserError(f"{ex['name']}: {len(sets)} rondas; el máximo es {MAX_ROUNDS}.")
        out.append((ex, [check_set(ex, i, s if isinstance(s, dict) else s.model_dump()) for i, s in enumerate(sets, 1)]))
    return out


def check_duration(v) -> int | None:
    if v is None:
        return None
    lo, hi = DURATION_RANGE
    if not lo <= float(v) <= hi:
        raise UserError(f"duration_min {v} fuera de rango ({lo}–{hi} minutos).")
    return round(float(v) * 60)


async def _insert_logs(c, sid: str, parsed) -> None:
    for ex, sets in parsed:
        await c.execute("delete from session_logs where session_id = %s and exercise_id = %s", (sid, ex["id"]))
        for rnd, (reps, kg) in enumerate(sets, 1):
            await c.execute(
                "insert into session_logs (session_id, exercise_id, round_number, reps, weight_kg) "
                "values (%s, %s, %s, %s, %s)",
                (sid, ex["id"], rnd, reps, kg),
            )


def _dictated_rounds(parsed) -> int:
    main = [len(s) for ex, s in parsed if ex["block"] == "main"] or [len(s) for _, s in parsed]
    return max(main) if main else 0


def check_rounds(v) -> int:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not float(v).is_integer() or not 1 <= v <= MAX_ROUNDS:
        raise UserError(f"rounds debe ser un entero entre 1 y {MAX_ROUNDS}, no '{v}'.")
    return int(v)


def check_bool(v, field: str) -> bool:
    if not isinstance(v, bool):
        raise UserError(f"{field} debe ser true o false, no '{v}'.")
    return v


async def _dup_session(uid: str, d: date, day_id: int, exclude: str | None = None):
    return await db.fetchrow(
        "select id from sessions where user_id = %s and date = %s and day_id = %s "
        "and (%s::uuid is null or id <> %s::uuid) limit 1",
        uid, d, day_id, exclude, exclude,
    )


# --------------------------------- peso --------------------------------------
async def log_weight(date_s: str, weight_kg, standard_conditions: bool = True, note: str | None = None) -> dict:
    d, kg, uid = check_date(date_s), check_weight(weight_kg), await user_id()
    cur = await db.fetchrow("select * from body_measurements where user_id = %s and date = %s", uid, d)
    if cur and cur["weight_kg"] is not None:
        raise UserError(
            f"Ya hay un peso el {d}: {float(cur['weight_kg'])} kg (id {cur['id']}). No lo sobrescribo: "
            f"para cambiarlo usa update_entry(type='weight', id='{cur['id']}', fields={{'weight_kg': …}})."
        )
    if cur:  # fila de ese día sin peso (p. ej. solo cintura): se completa
        row = await db.fetchrow(
            "update body_measurements set weight_kg = %s, is_standard_conditions = %s, note = coalesce(%s, note) "
            "where id = %s returning *",
            kg, standard_conditions, note, cur["id"],
        )
    else:
        row = await db.fetchrow(
            "insert into body_measurements (user_id, date, weight_kg, is_standard_conditions, note) "
            "values (%s, %s, %s, %s, %s) returning *",
            uid, d, kg, standard_conditions, note,
        )
    return {"saved": "weight", "record": measurement_out(row)}


# -------------------------------- sesión -------------------------------------
async def log_session(date_s: str, day: str, exercises, duration_min=None, deload: bool = False,
                      note: str | None = None, rounds=None) -> dict:
    d, dayrow, uid = check_date(date_s), await resolve_day(day), await user_id()
    parsed = parse_exercises(exercises, await _day_exercises(dayrow["id"]), dayrow["name"])
    dur = check_duration(duration_min)
    # Rondas: las dichas; si no, las del plan (o de deload), o más si se dictaron más.
    planned = dayrow["rounds_deload"] if deload else dayrow["rounds"]
    n_rounds = check_rounds(rounds) if rounds is not None else max(planned, _dictated_rounds(parsed))
    dup = await _dup_session(uid, d, dayrow["id"])
    if dup:
        raise UserError(
            f"Ya hay una sesión de {dayrow['name']} el {d} (id {dup['id']}). Para añadir o corregir ejercicios "
            f"usa update_entry(type='session', id='{dup['id']}', fields={{'exercises': [...]}})."
        )
    async with db.conn() as c:
        async with c.transaction():
            cur = await c.execute(
                "insert into sessions (user_id, day_id, date, is_deload, rounds_completed, work_sec, duration_sec, source, note) "
                "values (%s, %s, %s, %s, %s, %s, %s, 'manual', %s) returning id",
                (uid, dayrow["id"], d, deload, n_rounds, dayrow["work_sec"], dur, note),
            )
            sid = str((await cur.fetchone())["id"])
            await _insert_logs(c, sid, parsed)
    return {"saved": "session", "record": await session_by_id(sid)}


# --------------------------- corregir / borrar -------------------------------
def _check_fields(fields: dict, allowed: set, kind: str) -> dict:
    if not fields:
        raise UserError(f"fields vacío. Campos de {kind}: {', '.join(sorted(allowed))}.")
    bad = set(fields) - allowed
    if bad:
        raise UserError(f"Campo(s) no válidos para {kind}: {', '.join(sorted(bad))}. Permitidos: {', '.join(sorted(allowed))}.")
    return fields


async def update_entry(kind: str, id_: str, fields: dict) -> dict:
    uid = await user_id()
    if kind == "weight":
        mid = check_uuid(id_, "peso")
        f = _check_fields(fields, WEIGHT_FIELDS, "weight")
        cur = await db.fetchrow("select * from body_measurements where id = %s and user_id = %s", mid, uid)
        if not cur:
            raise UserError(f"No hay ningún peso con id {mid}.")
        d = check_date(f["date"]) if "date" in f else cur["date"]
        if d != cur["date"]:
            other = await db.fetchrow("select id from body_measurements where user_id = %s and date = %s", uid, d)
            if other:
                raise UserError(f"Ya hay un registro el {d} (id {other['id']}); no muevo este encima.")
        kg = check_weight(f["weight_kg"]) if "weight_kg" in f else cur["weight_kg"]
        std = check_bool(f["standard_conditions"], "standard_conditions") if "standard_conditions" in f else cur["is_standard_conditions"]
        note = f["note"] if "note" in f else cur["note"]
        row = await db.fetchrow(
            "update body_measurements set date = %s, weight_kg = %s, is_standard_conditions = %s, note = %s "
            "where id = %s returning *",
            d, kg, std, note, mid,
        )
        return {"updated": "weight", "before": measurement_out(cur), "record": measurement_out(row)}

    if kind == "session":
        sid = check_uuid(id_, "sesión")
        f = _check_fields(fields, SESSION_FIELDS, "session")
        before = await session_by_id(sid)
        if not before:
            raise UserError(f"No hay ninguna sesión con id {sid}.")
        cur = await db.fetchrow("select * from sessions where id = %s", sid)
        d = check_date(f["date"]) if "date" in f else cur["date"]
        if d != cur["date"]:
            dup = await _dup_session(uid, d, cur["day_id"], exclude=sid)
            if dup:
                raise UserError(f"Ya hay una sesión de ese día el {d} (id {dup['id']}); no muevo esta encima.")
        parsed = []
        if "exercises" in f:
            dayrow = await resolve_day(cur["day_id"])
            parsed = parse_exercises(f["exercises"], await _day_exercises(cur["day_id"]), dayrow["name"])
        dur = check_duration(f["duration_min"]) if "duration_min" in f else cur["duration_sec"]
        deload = check_bool(f["deload"], "deload") if "deload" in f else cur["is_deload"]
        if "rounds" in f:
            n_rounds = check_rounds(f["rounds"])
        else:  # si se dictan más rondas de las que constaban, sube; nunca baja sola
            n_rounds = max(cur["rounds_completed"] or 0, _dictated_rounds(parsed)) or None
        async with db.conn() as c:
            async with c.transaction():
                await c.execute(
                    "update sessions set date = %s, is_deload = %s, duration_sec = %s, rounds_completed = %s, "
                    "note = %s where id = %s",
                    (d, deload, dur, n_rounds, f["note"] if "note" in f else cur["note"], sid),
                )
                if parsed:
                    await _insert_logs(c, sid, parsed)
        return {"updated": "session", "before": before, "record": await session_by_id(sid)}

    raise UserError(f"type '{kind}' no válido: usa 'weight' o 'session'.")


async def delete_entry(kind: str, id_: str) -> dict:
    uid = await user_id()
    if kind == "weight":
        mid = check_uuid(id_, "peso")
        row = await db.fetchrow("delete from body_measurements where id = %s and user_id = %s returning *", mid, uid)
        if not row:
            raise UserError(f"No hay ningún peso con id {mid}.")
        return {"deleted": "weight", "record": measurement_out(row)}
    if kind == "session":
        sid = check_uuid(id_, "sesión")
        before = await session_by_id(sid)
        if not before:
            raise UserError(f"No hay ninguna sesión con id {sid}.")
        await db.execute("delete from sessions where id = %s and user_id = %s", sid, uid)  # logs en cascada
        return {"deleted": "session", "record": before}
    raise UserError(f"type '{kind}' no válido: usa 'weight' o 'session'.")
