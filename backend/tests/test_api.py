import json
import os

from conftest import ROOT, _psql


def test_auth_required(client):
    assert client.get("/api/bootstrap").status_code == 401
    assert client.post("/api/login", json={"pin": "0000"}).status_code == 401
    assert client.post("/api/login", json={"pin": "4321"}).status_code == 200
    assert client.get("/api/me").json() == {"authenticated": True}


def test_bootstrap_shape(auth_client):
    b = auth_client.get("/api/bootstrap").json()
    days = {d["id"]: d for d in b["days"]}
    assert set(days) == {0, 1, 2, 3, 4, 5}
    assert [e["name"] for e in days[0]["exercises"]] == [
        "Jumping jacks",
        "Rotación de hombros",
        "Sentadillas al aire",
        "Transición / respiración",
    ]
    main1 = [e for e in days[1]["exercises"] if e["block"] == "main"]
    rem1 = [e for e in days[1]["exercises"] if e["block"] == "remate"]
    assert len(main1) == 4 and len(rem1) == 1
    assert days[1]["rounds"] == 3 and days[1]["rounds_deload"] == 2
    assert b["settings"]["goal_weight_kg"] == 70


def test_workout_flow_and_dashboard(auth_client):
    c = auth_client
    main1 = [
        e for e in c.get("/api/bootstrap").json()["days"][1]["exercises"] if e["block"] == "main"
    ]
    ex_id = main1[0]["id"]

    sid = c.post(
        "/api/sessions",
        json={
            "day_id": 1,
            "date": "2026-09-08",
            "rounds_planned": 3,
            "is_deload": False,
            "source": "timer",
            "work_sec": 40,
        },
    ).json()["id"]
    assert c.patch(f"/api/sessions/{sid}", json={"rounds_completed": 3, "duration_sec": 700}).status_code == 200
    assert c.post(
        f"/api/sessions/{sid}/logs",
        json={"logs": [{"exercise_id": ex_id, "reps": 12, "round_number": 1}]},
    ).status_code == 200
    assert c.get("/api/prefill?day_id=1").json() == {str(ex_id): 12}

    assert c.post(
        "/api/measurements",
        json={"date": "2026-09-08", "weight_kg": 74.2, "waist_cm": 88.0, "is_standard_conditions": True},
    ).status_code == 200

    d = c.get("/api/dashboard").json()
    assert d["goal_weight_kg"] == 70
    assert len(d["measurements"]) == 1
    assert len(d["sessions"]) == 1
    assert d["strength"][0]["reps"] == 12 and d["strength"][0]["work_sec"] == 40


def test_logs_reject_foreign_session(auth_client):
    r = auth_client.post(
        "/api/sessions/00000000-0000-0000-0000-000000000000/logs", json={"logs": []}
    )
    assert r.status_code == 404


def test_seed_matches_plan(auth_client):
    plan = json.loads((ROOT / "plan" / "plan.json").read_text())
    days = {d["id"]: d for d in auth_client.get("/api/bootstrap").json()["days"]}
    for pd in plan["dias"]:
        if not pd["ejercicios"]:
            continue
        got = [e["name"] for e in days[pd["id"]]["exercises"] if e["block"] == "main"]
        want = [e["nombre"] for e in pd["ejercicios"]]
        assert got == want, f"día {pd['id']}: seed.sql y plan.json divergen"


def _assert_all_instructions(client):
    days = client.get("/api/bootstrap").json()["days"]
    exs = [e for d in days for e in d["exercises"]]
    assert len(exs) == 24  # 4 de calentamiento + 5 por cada día 1-4
    for e in exs:
        txt = e.get("instructions")
        assert isinstance(txt, str) and len(txt.strip()) > 20, f"ejercicio {e['id']} sin instrucciones"


def test_all_exercises_have_instructions(auth_client):
    _assert_all_instructions(auth_client)


def test_instructions_migration_is_idempotent(auth_client):
    """Simula una BD de producción anterior (sin la columna): schema.sql la
    añade, el seed la rellena y re-aplicar schema.sql no rompe nada."""
    db_url = os.environ["DATABASE_URL"]
    schema = str(ROOT / "db" / "schema.sql")
    seed = str(ROOT / "db" / "seed.sql")
    _psql(db_url, "-c", "alter table exercises drop column if exists instructions;")
    _psql(db_url, "-f", schema)
    _psql(db_url, "-f", seed)
    _psql(db_url, "-f", schema)
    _psql(db_url, "-f", seed)
    _assert_all_instructions(auth_client)


# ------------------------------- autopausa ---------------------------------
def _exercises(client):
    days = client.get("/api/bootstrap").json()["days"]
    return {e["id"]: e for d in days for e in d["exercises"]}


def test_autopause_default_off_and_requires_auth(client):
    assert client.patch("/api/exercises/autopause", json={"updates": []}).status_code == 401


def test_autopause_update(auth_client):
    c = auth_client
    exs = _exercises(c)
    assert all(e["autopause"] is False for e in exs.values())
    r = c.patch(
        "/api/exercises/autopause",
        json={"updates": [{"id": 11, "autopause": True}, {"id": 14, "autopause": True}]},
    )
    assert r.status_code == 200 and r.json() == {"updated": 2}
    exs = _exercises(c)
    assert [i for i, e in exs.items() if e["autopause"]] == [11, 14]
    c.patch("/api/exercises/autopause", json={"updates": [{"id": 14, "autopause": False}]})
    assert [i for i, e in _exercises(c).items() if e["autopause"]] == [11]
    # id inexistente: no rompe, simplemente no actualiza nada
    assert c.patch(
        "/api/exercises/autopause", json={"updates": [{"id": 999, "autopause": True}]}
    ).json() == {"updated": 0}


def test_autopause_survives_deploy(auth_client):
    """Cada deploy re-aplica schema.sql y seed.sql: la preferencia no se pierde
    y la migración funciona sobre una BD sin la columna."""
    c = auth_client
    c.patch("/api/exercises/autopause", json={"updates": [{"id": 12, "autopause": True}]})
    db_url = os.environ["DATABASE_URL"]
    _psql(db_url, "-f", str(ROOT / "db" / "schema.sql"))
    _psql(db_url, "-f", str(ROOT / "db" / "seed.sql"))
    assert _exercises(c)[12]["autopause"] is True
    _psql(db_url, "-c", "alter table exercises drop column autopause;")
    _psql(db_url, "-f", str(ROOT / "db" / "schema.sql"))
    _psql(db_url, "-f", str(ROOT / "db" / "seed.sql"))
    assert all(e["autopause"] is False for e in _exercises(c).values())


def test_static_files_are_revalidated(client):
    """Sin Cache-Control, Safari reutiliza JS viejo por heurística y puede mezclar
    versiones (app.js nuevo con timer.js antiguo). Todo el shell: no-cache."""
    for path in ("/", "/js/app.js", "/js/timer.js", "/sw.js", "/styles.css"):
        r = client.get(path)
        assert r.status_code == 200, path
        assert r.headers.get("cache-control") == "no-cache", path
    assert "no-cache" not in (client.get("/api/me").headers.get("cache-control") or "")
