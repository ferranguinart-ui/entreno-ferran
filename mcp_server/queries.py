"""Lecturas del MCP sobre la misma BD que la app (backend/db.py). Sin estado propio.
Devuelven dicts listos para JSON: fechas "YYYY-MM-DD", kg como float."""
from __future__ import annotations

import re
import unicodedata
from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import db
from progression import plates_text, progression

TZ = ZoneInfo("Europe/Madrid")
WEEK_GOAL = 4          # sesiones (días distintos) por semana, igual que la app
DEFAULT_DAYS = 90      # ventana por defecto si no se pasan fechas
PLAN_DAY_IDS = (1, 2, 3, 4, 5)


class UserError(ValueError):
    """Error que Claude debe leer y corregir (fecha mal, día que no existe…)."""


def today() -> date:
    return datetime.now(TZ).date()


async def session_by_id(sid: str) -> dict | None:
    rows = await _sessions(await user_id(), ids=[sid])
    return rows[0] if rows else None


def measurement_out(r: dict) -> dict:
    it = {"id": str(r["id"]), "date": _d(r["date"]), "weight_kg": _f(r["weight_kg"]),
          "standard_conditions": r["is_standard_conditions"]}
    if r.get("note"):
        it["note"] = r["note"]
    return it


def _f(v):
    return float(v) if isinstance(v, Decimal) else v


def _d(v) -> str | None:
    return v.isoformat() if v is not None else None


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", str(s).lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s).strip()


def parse_date(s: str | None, field: str) -> date | None:
    if s in (None, ""):
        return None
    try:
        return date.fromisoformat(s)
    except ValueError:
        raise UserError(f"{field}: fecha no válida '{s}'. Usa el formato YYYY-MM-DD.")


def date_range(from_date: str | None, to_date: str | None) -> tuple[date, date]:
    to = parse_date(to_date, "to_date") or today()
    frm = parse_date(from_date, "from_date") or (to - timedelta(days=DEFAULT_DAYS))
    if frm > to:
        raise UserError(f"from_date ({frm}) es posterior a to_date ({to}).")
    return frm, to


async def user_id() -> str:
    row = await db.fetchrow("select id from users order by created_at limit 1")
    if row is None:
        raise UserError("La app aún no tiene usuario.")
    return str(row["id"])


# ------------------------------- días del plan -------------------------------
async def plan_days() -> list[dict]:
    return await db.fetch(
        "select * from training_days where id = any(%s) order by sort_order", list(PLAN_DAY_IDS)
    )


async def resolve_day(day: str | int) -> dict:
    """'Empuje', 'traccion', 'día 3', '3' → fila de training_days. Error con la lista si no encaja."""
    days = await plan_days()
    q = norm(day)
    m = re.fullmatch(r"(?:dia )?(\d+)", q)
    hits = [d for d in days if m and d["id"] == int(m.group(1))]
    if not hits:
        hits = [d for d in days if norm(d["name"]) == q]
    if not hits:
        hits = [d for d in days if norm(d["name"]).startswith(q) or q.startswith(norm(d["name"]).split(" ")[0])]
    if len(hits) != 1:
        valid = ", ".join(f"{d['name']} (día {d['id']})" for d in days)
        raise UserError(f"Día '{day}' no reconocido. Días válidos: {valid}.")
    return hits[0]


# --------------------------------- plan --------------------------------------
async def get_plan() -> dict:
    days = await db.fetch("select * from training_days order by sort_order")
    exs = await db.fetch(
        "select * from exercises order by day_id, "
        "case block when 'warmup' then 0 when 'main' then 1 when 'remate' then 2 else 3 end, sort_order"
    )
    by_day: dict[int, list] = {}
    for e in exs:
        by_day.setdefault(e["day_id"], []).append(e)

    def ex_out(e, d):
        out = {
            "name": e["name"],
            "block": e["block"],
            "work_sec": e["work_sec"] or d["work_sec"],
            "rest_after_sec": e["rest_sec"] if e["rest_sec"] is not None else d["rest_ex_sec"],
            "muscles": e["muscle_primary"],
        }
        if e["muscle_secondary"]:
            out["muscles_secondary"] = e["muscle_secondary"]
        if e["equipment"]:
            out["equipment"] = e["equipment"]
        if e["rep_min"] is not None:
            out["rep_range"] = [e["rep_min"], e["rep_max"]]
        if e["rounds"] is not None:
            out["rounds"] = e["rounds"]
        if e["is_optional"]:
            out["optional"] = True
        return out

    out_days = []
    warmup = None
    for d in days:
        item = {
            "id": d["id"],
            "name": d["name"],
            "focus": d["focus"],
            "rounds": d["rounds"],
            "rounds_range": [d["rounds_min"], d["rounds_max"]],
            "rounds_deload": d["rounds_deload"],
            "rest_between_rounds_sec": d["rest_round_sec"],
            "exercises": [ex_out(e, d) for e in by_day.get(d["id"], [])],
        }
        if d["note"]:
            item["note"] = d["note"]
        if d["id"] == 0:
            warmup = item
        else:
            out_days.append(item)
    return {
        "equipment_legend": {
            "pair": "dos mancuernas iguales; kg = POR mancuerna (solo discos, las barras pesan ~0)",
            "single": "una mancuerna; kg = discos de esa mancuerna",
            "bar": "las dos mancuernas unidas en una barra; kg = todos los discos",
            "bodyweight": "peso corporal, sin kg",
        },
        "progression_rule": (
            "Doble progresión: subir al siguiente peso montable tras 2 sesiones seguidas con el mismo kg "
            "y el máximo del rango en todas las rondas, o ya tras 1 sesión si en todas las rondas (al menos 2 apuntadas) "
            "se superó el máximo en 4 o más reps; bajar tras 2 sesiones con alguna ronda bajo el mínimo. "
            "Las sesiones de descarga (deload) no cuentan."
        ),
        "warmup": warmup,
        "days": out_days,
    }


# ------------------------------- medidas -------------------------------------
async def get_measurements(from_date: str | None, to_date: str | None) -> dict:
    frm, to = date_range(from_date, to_date)
    uid = await user_id()
    rows = await db.fetch(
        """
        select id, date, weight_kg, is_standard_conditions, note from body_measurements
        where user_id = %s and date between %s and %s and weight_kg is not null
        order by date
        """,
        uid, frm, to,
    )
    items = [measurement_out(r) for r in rows]
    return {"from": _d(frm), "to": _d(to), "count": len(items), "measurements": items}


# ------------------------------- sesiones ------------------------------------
async def _sessions(uid: str, frm: date | None = None, to: date | None = None,
                    day_id: int | None = None, ids: list | None = None) -> list[dict]:
    ses = await db.fetch(
        """
        select s.*, d.name as day_name from sessions s join training_days d on d.id = s.day_id
        where s.user_id = %s
          and (%s::date is null or s.date >= %s::date) and (%s::date is null or s.date <= %s::date)
          and (%s::smallint is null or s.day_id = %s::smallint)
          and (%s::uuid[] is null or s.id = any(%s::uuid[]))
        order by s.date, s.created_at
        """,
        uid, frm, frm, to, to, day_id, day_id, ids, ids,
    )
    if not ses:
        return []
    logs = await db.fetch(
        """
        select sl.session_id, sl.round_number, sl.reps, sl.weight_kg,
               e.id as exercise_id, e.name, e.equipment, e.sort_order, e.block
        from session_logs sl join exercises e on e.id = sl.exercise_id
        where sl.session_id = any(%s) and (sl.reps is not null or sl.weight_kg is not null)
        order by e.day_id, case e.block when 'warmup' then 0 when 'main' then 1 else 2 end,
                 e.sort_order, sl.round_number
        """,
        [s["id"] for s in ses],
    )
    by_ses: dict = {}
    for l in logs:
        exs = by_ses.setdefault(l["session_id"], [])
        if not exs or exs[-1]["_id"] != l["exercise_id"]:
            exs.append({"_id": l["exercise_id"], "name": l["name"], "equipment": l["equipment"], "sets": []})
        st = {"round": l["round_number"], "reps": l["reps"]}
        if l["weight_kg"] is not None:
            st["kg"] = _f(l["weight_kg"])
        exs[-1]["sets"].append(st)
    out = []
    for s in ses:
        exs = by_ses.get(s["id"], [])
        for e in exs:
            e.pop("_id")
        it = {
            "id": str(s["id"]),
            "date": _d(s["date"]),
            "day": s["day_name"],
            "day_id": s["day_id"],
            "source": s["source"],
            "deload": s["is_deload"],
            "rounds_completed": s["rounds_completed"],
            "duration_min": round(s["duration_sec"] / 60, 1) if s["duration_sec"] else None,
            "exercises": exs,
        }
        if s.get("note"):
            it["note"] = s["note"]
        out.append(it)
    return out


async def get_sessions(from_date: str | None, to_date: str | None, day: str | None) -> dict:
    frm, to = date_range(from_date, to_date)
    d = await resolve_day(day) if day not in (None, "") else None
    items = await _sessions(await user_id(), frm, to, d["id"] if d else None)
    return {"from": _d(frm), "to": _d(to), "count": len(items), "sessions": items}


# ------------------------------- hoy toca ------------------------------------
async def _history(uid: str, day_id: int, limit: int = 6) -> dict[int, list[dict]]:
    """Mismo criterio que /api/last_logs: últimas sesiones con algo apuntado por ejercicio."""
    rows = await db.fetch(
        """
        with ses as (
          select s.id, s.date, s.is_deload, s.created_at, sl.exercise_id,
                 dense_rank() over (partition by sl.exercise_id
                                    order by s.date desc, s.created_at desc) as rk
          from sessions s
          join session_logs sl on sl.session_id = s.id
          join exercises e on e.id = sl.exercise_id
          where s.user_id = %s and e.day_id = %s
            and (sl.reps is not null or sl.weight_kg is not null)
          group by s.id, s.date, s.is_deload, s.created_at, sl.exercise_id
        )
        select ses.exercise_id, ses.date, ses.is_deload, ses.rk, sl.round_number, sl.reps, sl.weight_kg
        from ses join session_logs sl on sl.session_id = ses.id and sl.exercise_id = ses.exercise_id
        where ses.rk <= %s
        order by ses.exercise_id, ses.rk, sl.round_number
        """,
        uid, day_id, limit,
    )
    out: dict[int, list[dict]] = {}
    for r in rows:
        hist = out.setdefault(r["exercise_id"], [])
        if not hist or hist[-1]["_rk"] != r["rk"]:
            hist.append({"_rk": r["rk"], "date": _d(r["date"]), "deload": r["is_deload"], "kg": None, "reps": []})
        h = hist[-1]
        kg = _f(r["weight_kg"])
        if h["kg"] is None and kg is not None:
            h["kg"] = kg  # peso de la sesión = el de la primera ronda con peso
        if r["reps"] is not None:
            h["reps"].append(r["reps"])
    return out


ACTION_TEXT = {
    "start": "sin historial con peso: elegir un peso con el que llegar al rango",
    "hold": "mantener el peso",
    "up": "subir de peso",
    "down": "bajar de peso",
}


async def get_targets(day: str) -> dict:
    d = await resolve_day(day)
    uid = await user_id()
    exs = await db.fetch(
        "select * from exercises where day_id = %s and block in ('main', 'remate') order by block = 'remate', sort_order",
        d["id"],
    )
    hist = await _history(uid, d["id"])
    items = []
    for e in exs:
        h = hist.get(e["id"], [])
        p = progression(h, e)
        it = {"exercise": e["name"], "equipment": e["equipment"], **p, "advice": ACTION_TEXT[p["action"]]}
        if e["rep_min"] is not None:
            it["rep_range"] = [e["rep_min"], e["rep_max"]]
        if p["kg"] is not None:
            it["plates"] = plates_text(p["kg"], e["equipment"])
        if h:
            it["last"] = {"date": h[0]["date"], "kg": h[0]["kg"], "reps": h[0]["reps"], "deload": h[0]["deload"]}
        items.append(it)
    return {"day": d["name"], "day_id": d["id"], "targets": items}


# -------------------------------- resumen ------------------------------------
async def get_summary() -> dict:
    uid = await user_id()
    t = today()
    st = await db.fetchrow("select goal_weight_kg, phase, moving_avg_window from settings where id = 1")
    window = (st or {}).get("moving_avg_window") or 7
    weights = await db.fetch(
        "select date, weight_kg, is_standard_conditions from body_measurements "
        "where user_id = %s and weight_kg is not null order by date",
        uid,
    )
    weight = None
    if weights:
        last = weights[-1]
        recent = [_f(w["weight_kg"]) for w in weights[-window:]]
        lo = min(weights, key=lambda w: (w["weight_kg"], w["date"]))
        weight = {
            "last": {"date": _d(last["date"]), "kg": _f(last["weight_kg"]),
                     "standard_conditions": last["is_standard_conditions"]},
            f"moving_avg_{window}": round(sum(recent) / len(recent), 2),
            "min": {"date": _d(lo["date"]), "kg": _f(lo["weight_kg"])},
            "records": len(weights),
        }
        if st:
            weight["goal_kg"] = _f(st["goal_weight_kg"])
            weight["to_goal_kg"] = round(_f(last["weight_kg"]) - _f(st["goal_weight_kg"]), 1)

    monday = t - timedelta(days=t.weekday())
    week = await db.fetch(
        "select distinct s.date, d.name from sessions s join training_days d on d.id = s.day_id "
        "where s.user_id = %s and s.date between %s and %s order by s.date",
        uid, monday, monday + timedelta(days=6),
    )
    last_by_day = await db.fetch(
        """
        select distinct on (s.day_id) s.day_id, d.name, s.date, s.is_deload
        from sessions s join training_days d on d.id = s.day_id
        where s.user_id = %s order by s.day_id, s.date desc, s.created_at desc
        """,
        uid,
    )
    return {
        "today": _d(t),
        "phase": (st or {}).get("phase"),
        "weight": weight,
        "week": {
            "from": _d(monday),
            "to": _d(monday + timedelta(days=6)),
            "sessions_done": len({w["date"] for w in week}),
            "goal": WEEK_GOAL,
            "days": [{"date": _d(w["date"]), "day": w["name"]} for w in week],
        },
        "last_session_by_day": [
            {"day": r["name"], "date": _d(r["date"]), "days_ago": (t - r["date"]).days, "deload": r["is_deload"]}
            for r in last_by_day
        ],
    }
