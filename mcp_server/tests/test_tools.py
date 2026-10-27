"""Herramientas de lectura, llamadas como lo haría Claude (cliente MCP en memoria)."""
import json

import pytest
from mcp import Client

from server import mcp



async def call(name, args=None):
    async with Client(mcp) as c:
        r = await c.call_tool(name, args or {})
    return r


async def ok(name, args=None):
    r = await call(name, args)
    assert not r.is_error, r.content
    assert r.structured_content is None  # solo texto: el JSON va una vez
    return json.loads(r.content[0].text)


@pytest.mark.anyio
async def test_lista_de_herramientas_con_descripciones(pool):
    async with Client(mcp) as c:
        tools = {t.name: t for t in (await c.list_tools()).tools}
    assert set(tools) == {"get_summary", "get_measurements", "get_sessions", "get_plan", "get_targets",
                          "log_weight", "log_session", "update_entry", "delete_entry"}
    for t in tools.values():
        assert len(t.description) > 80
    props = tools["get_sessions"].input_schema["properties"]
    assert "YYYY-MM-DD" in json.dumps(props["from_date"])


@pytest.mark.anyio
async def test_summary(pool, today):
    s = await ok("get_summary")
    w = s["weight"]
    assert w["last"]["kg"] == 75.2
    assert w["min"]["kg"] == 75.2
    assert w["moving_avg_7"] == round((80 + 76.4 + 75.8 + 75.2) / 4, 2)
    assert w["goal_kg"] == 70 and w["to_goal_kg"] == 5.2
    assert s["week"]["goal"] == 4
    assert s["week"]["sessions_done"] == 1
    days = {x["day"]: x for x in s["last_session_by_day"]}
    assert days["Empuje"]["days_ago"] == 7
    assert days["Tracción"]["days_ago"] == 0


@pytest.mark.anyio
async def test_measurements_90_dias_por_defecto(pool):
    m = await ok("get_measurements")
    assert m["count"] == 3  # el de hace 200 días queda fuera
    no_std = [x for x in m["measurements"] if not x["standard_conditions"]]
    assert no_std[0]["note"] == "después de cenar"
    assert "waist_cm" not in json.dumps(m)


@pytest.mark.anyio
async def test_measurements_rango(pool, today):
    m = await ok("get_measurements", {"from_date": "2026-01-01", "to_date": today.isoformat()})
    assert m["count"] == 4


@pytest.mark.anyio
async def test_fecha_mal_formada_da_error_legible(pool):
    r = await call("get_measurements", {"from_date": "21/10/2026"})
    assert r.is_error
    assert "YYYY-MM-DD" in r.content[0].text


@pytest.mark.anyio
async def test_sessions_con_rondas_y_kg(pool):
    s = await ok("get_sessions", {"day": "empuje"})
    assert s["count"] == 2
    last = s["sessions"][-1]
    assert last["day"] == "Empuje" and last["duration_min"] == 18.3
    assert last["exercises"] == [
        {"name": "Press de pecho en suelo", "equipment": "pair",
         "sets": [{"round": 1, "reps": 15, "kg": 8.0}, {"round": 2, "reps": 14, "kg": 8.0}]}
    ]


@pytest.mark.anyio
async def test_dia_tolerante_y_error_con_lista(pool):
    assert (await ok("get_sessions", {"day": "TRACCION"}))["count"] == 1
    assert (await ok("get_sessions", {"day": "día 3"}))["count"] == 1
    r = await call("get_sessions", {"day": "espalda"})
    assert r.is_error and "Empuje (día 1)" in r.content[0].text


@pytest.mark.anyio
async def test_plan(pool):
    p = await ok("get_plan")
    assert [d["name"] for d in p["days"]][:4] == ["Empuje", "HIIT + core", "Tracción", "Piernas + core"]
    press = p["days"][0]["exercises"][0]
    assert press["name"] == "Press de pecho en suelo" and press["work_sec"] == 40
    assert press["rep_range"] and press["equipment"] == "pair"
    assert p["warmup"]["exercises"][0]["work_sec"] == 30
    # estiramientos al final de cada día, después del remate
    blocks = [e["block"] for e in p["days"][0]["exercises"]]
    assert blocks[-4:] == ["stretch"] * 4 and blocks.index("remate") < blocks.index("stretch")


@pytest.mark.anyio
async def test_targets_dice_cuando_subir(pool):
    t = await ok("get_targets", {"day": "Empuje"})
    press = next(x for x in t["targets"] if x["exercise"] == "Press de pecho en suelo")
    # rango 10-14: dos sesiones seguidas con 8 kg y ≥14 en todas las rondas → subir a 9
    assert press["action"] == "up" and press["kg"] == 9 and press["from"] == 8
    assert press["plates"] == "por lado: 2,5 + 2"
    assert press["last"]["reps"] == [15, 14]
    assert not any("marco" in x["exercise"] for x in t["targets"])  # los estiramientos no llevan peso
    aper = next(x for x in t["targets"] if x["exercise"] == "Aperturas en suelo")
    assert aper["action"] == "start"


def test_health(db_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", db_url)
    from starlette.testclient import TestClient

    import server

    with TestClient(server.create_app()) as c:
        assert c.get("/health").json() == {"status": "ok", "db": "ok"}
