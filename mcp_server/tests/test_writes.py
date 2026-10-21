"""Escrituras: validación en el servidor, registro devuelto con id y auditoría."""
import json
from datetime import timedelta

import pytest
from mcp import Client

import db
from server import mcp

pytestmark = pytest.mark.anyio


async def call(name, args):
    async with Client(mcp) as c:
        return await c.call_tool(name, args)


async def ok(name, args):
    r = await call(name, args)
    assert not r.is_error, r.content[0].text
    return json.loads(r.content[0].text)


async def err(name, args):
    r = await call(name, args)
    assert r.is_error, r.content[0].text
    return r.content[0].text


async def audit():
    return await db.fetch("select tool, ok, args, result from audit_log order by id")


# ---------------------------------- peso ----------------------------------
async def test_log_weight_guarda_y_audita(pool, today):
    d = (today - timedelta(days=3)).isoformat()
    r = await ok("log_weight", {"date": d, "weight_kg": 74.86, "standard_conditions": False, "note": "tras viaje"})
    rec = r["record"]
    assert rec["weight_kg"] == 74.9 and rec["standard_conditions"] is False and rec["id"]
    a = await audit()
    assert a[-1]["tool"] == "log_weight" and a[-1]["ok"] is True
    assert a[-1]["args"]["weight_kg"] == 74.86


async def test_log_weight_no_sobrescribe(pool, today):
    d = (today - timedelta(days=1)).isoformat()  # ya hay 75.2 ese día
    msg = await err("log_weight", {"date": d, "weight_kg": 74})
    assert "75.2" in msg and "update_entry" in msg
    assert (await audit())[-1]["ok"] is False
    m = await db.fetchrow("select weight_kg from body_measurements where date = %s", today - timedelta(days=1))
    assert float(m["weight_kg"]) == 75.2


@pytest.mark.parametrize("args, frag", [
    ({"weight_kg": 59.9}, "fuera de rango"),
    ({"weight_kg": 96}, "fuera de rango"),
    ({"date": "2025-12-31"}, "anterior a 2026-01-01"),
    ({"date": "2099-01-01"}, "futura"),
    ({"date": "ayer"}, "YYYY-MM-DD"),
])
async def test_log_weight_validaciones(pool, today, args, frag):
    base = {"date": (today - timedelta(days=4)).isoformat(), "weight_kg": 75}
    assert frag in await err("log_weight", {**base, **args})


# --------------------------------- sesión ---------------------------------
async def test_log_session_completa(pool, today):
    d = (today - timedelta(days=2)).isoformat()
    r = await ok("log_session", {
        "date": d, "day": "piernas", "duration_min": 17, "note": "rodilla bien",
        "exercises": [
            {"name": "sentadillas", "sets": [{"reps": 20}, {"reps": 18}, {"reps": 18}]},
            {"name": "crunch con peso al pecho", "sets": [{"reps": 16, "kg": 5}, {"reps": 15, "kg": 5}]},
            {"name": "plancha estatica", "sets": [{"kg": 0}]},
        ],
    })
    s = r["record"]
    assert s["day"] == "Piernas + core" and s["source"] == "manual" and s["duration_min"] == 17.0
    assert s["rounds_completed"] == 3 and s["note"] == "rodilla bien"
    names = [e["name"] for e in s["exercises"]]
    assert names == ["Sentadillas", "Crunch con peso al pecho"]  # plancha sin reps ni kg útil → no aparece
    assert s["exercises"][1]["sets"][0] == {"round": 1, "reps": 16, "kg": 5.0}
    # la app lo ve: queda en sessions/session_logs como cualquier sesión manual
    n = await db.fetchrow("select count(*) as n from session_logs where session_id = %s", s["id"])
    assert n["n"] == 6


async def test_log_session_nombre_parcial_si_es_unico(pool, today):
    r = await ok("log_session", {"date": today.isoformat(), "day": "empuje",
                                 "exercises": [{"name": "press militar", "sets": [{"reps": 12, "kg": 7.5}]}]})
    assert r["record"]["exercises"][0]["name"] == "Press militar"
    msg = await err("log_session", {"date": (today - timedelta(days=30)).isoformat(), "day": "empuje",
                                    "exercises": [{"name": "press", "sets": [{"reps": 12}]}]})
    assert "Válidos: Press de pecho en suelo" in msg  # 'press' encaja con dos → error con la lista


async def test_log_session_kg_no_montable(pool, today):
    msg = await err("log_session", {"date": today.isoformat(), "day": "empuje",
                                    "exercises": [{"name": "Press de pecho en suelo", "sets": [{"reps": 12, "kg": 6}]}]})
    assert "6 kg por mancuerna no se puede montar" in msg and "5,5 o 6,5" in msg


@pytest.mark.parametrize("ex, frag", [
    ({"name": "Sentadillas", "sets": [{"reps": 20, "kg": 5}]}, "peso corporal"),
    ({"name": "Sentadillas", "sets": [{"reps": 101}]}, "fuera de rango"),
    ({"name": "Sentadillas", "sets": [{}]}, "falta reps o kg"),
    ({"name": "Press militar", "sets": [{"reps": 10}]}, "no encontrado en Piernas"),
])
async def test_log_session_validaciones(pool, today, ex, frag):
    assert frag in await err("log_session", {"date": today.isoformat(), "day": "piernas", "exercises": [ex]})
    assert (await db.fetchrow("select count(*) as n from sessions where day_id = 4"))["n"] == 0


async def test_log_session_duplicada(pool, today):
    msg = await err("log_session", {"date": today.isoformat(), "day": "traccion", "exercises": []})
    assert "Ya hay una sesión de Tracción" in msg and "10000000-0000-0000-0000-000000000003" in msg


# -------------------------- corregir y borrar ------------------------------
async def test_update_weight(pool, today):
    m = await db.fetchrow("select id from body_measurements where date = %s", today - timedelta(days=1))
    r = await ok("update_entry", {"type": "weight", "id": str(m["id"]), "fields": {"weight_kg": 75.0, "note": "corregido"}})
    assert r["before"]["weight_kg"] == 75.2 and r["record"]["weight_kg"] == 75.0
    assert "fuera de rango" in await err("update_entry", {"type": "weight", "id": str(m["id"]), "fields": {"weight_kg": 20}})
    assert "no válidos" in await err("update_entry", {"type": "weight", "id": str(m["id"]), "fields": {"waist_cm": 80}})


async def test_update_session_solo_toca_el_ejercicio_pasado(pool):
    sid = "10000000-0000-0000-0000-000000000002"
    r = await ok("update_entry", {"type": "session", "id": sid, "fields": {
        "deload": True, "exercises": [{"name": "Aperturas en suelo", "sets": [{"reps": 14, "kg": 5}, {"reps": 13, "kg": 5}]}]}})
    s = r["record"]
    assert s["deload"] is True
    by = {e["name"]: e["sets"] for e in s["exercises"]}
    assert by["Press de pecho en suelo"] == [{"round": 1, "reps": 15, "kg": 8.0}, {"round": 2, "reps": 14, "kg": 8.0}]
    assert by["Aperturas en suelo"][1] == {"round": 2, "reps": 13, "kg": 5.0}


async def test_delete(pool):
    sid = "10000000-0000-0000-0000-000000000001"
    r = await ok("delete_entry", {"type": "session", "id": sid})
    assert r["record"]["id"] == sid and r["record"]["exercises"]
    assert await db.fetchrow("select 1 from session_logs where session_id = %s", sid) is None
    assert "No hay ninguna sesión" in await err("delete_entry", {"type": "session", "id": sid})
    assert "no válido" in await err("delete_entry", {"type": "session", "id": "abc"})
    a = await audit()
    assert [x["tool"] for x in a] == ["delete_entry"] * 3 and [x["ok"] for x in a] == [True, False, False]


# ------------------------- correcciones del revisor -------------------------
async def test_rondas_por_defecto_las_del_plan(pool, today):
    d = (today - timedelta(days=5)).isoformat()
    r = await ok("log_session", {"date": d, "day": "empuje",
                                 "exercises": [{"name": "press militar", "sets": [{"reps": 12, "kg": 7.5}]}]})
    assert r["record"]["rounds_completed"] == 3  # solo dictó la ronda 1, pero hizo las 3 del plan
    r = await ok("log_session", {"date": d, "day": "hiit", "deload": True, "exercises": []})
    assert r["record"]["rounds_completed"] == 2  # deload
    r = await ok("log_session", {"date": d, "day": "piernas", "rounds": 4, "exercises": []})
    assert r["record"]["rounds_completed"] == 4


async def test_update_rondas_puede_bajar(pool):
    sid = "10000000-0000-0000-0000-000000000002"
    r = await ok("update_entry", {"type": "session", "id": sid, "fields": {"rounds": 2}})
    assert r["before"]["rounds_completed"] == 3 and r["record"]["rounds_completed"] == 2
    assert "entero entre 1 y 10" in await err("update_entry", {"type": "session", "id": sid, "fields": {"rounds": 0}})


async def test_mover_fecha_no_crea_duplicado(pool, today):
    # la sesión de Empuje de hace 14 días no puede ir encima de la de hace 7
    msg = await err("update_entry", {"type": "session", "id": "10000000-0000-0000-0000-000000000001",
                                     "fields": {"date": (today - timedelta(days=7)).isoformat()}})
    assert "10000000-0000-0000-0000-000000000002" in msg


async def test_booleanos_estrictos(pool):
    sid = "10000000-0000-0000-0000-000000000002"
    assert "true o false" in await err("update_entry", {"type": "session", "id": sid, "fields": {"deload": "false"}})


async def test_reps_decimales_rechazadas_y_auditadas(pool, today):
    msg = await err("log_session", {"date": today.isoformat(), "day": "empuje",
                                    "exercises": [{"name": "press militar", "sets": [{"reps": 12.5}]}]})
    assert "entero" in msg
    assert (await audit())[-1]["ok"] is False


async def test_si_falla_la_auditoria_la_respuesta_no_cambia(pool, today, monkeypatch):
    import server

    async def boom(*a, **k):
        raise RuntimeError("audit caído")

    real = db.execute
    monkeypatch.setattr(server.db, "execute", lambda sql, *a: boom() if "audit_log" in sql else real(sql, *a))
    r = await ok("log_weight", {"date": (today - timedelta(days=6)).isoformat(), "weight_kg": 75})
    assert r["record"]["weight_kg"] == 75.0
    assert "75.2" in await err("log_weight", {"date": (today - timedelta(days=1)).isoformat(), "weight_kg": 74})
