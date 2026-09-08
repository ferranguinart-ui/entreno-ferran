import json

from conftest import ROOT


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
