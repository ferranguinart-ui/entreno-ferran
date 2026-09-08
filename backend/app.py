from __future__ import annotations

import hashlib
import hmac
import os
import secrets
from contextlib import asynccontextmanager
from datetime import date as date_cls
from typing import Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.staticfiles import StaticFiles
from itsdangerous import BadSignature, URLSafeSerializer
from pydantic import BaseModel

import db

load_dotenv()

SESSION_SECRET = os.environ.get("SESSION_SECRET", "dev-insecure-change-me")
COOKIE_NAME = "sid"
signer = URLSafeSerializer(SESSION_SECRET, salt="entreno-session")

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")


# ----------------------------- PIN hashing --------------------------------
def hash_pin(pin: str) -> str:
    salt = secrets.token_bytes(16)
    it = 200_000
    dk = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt, it)
    return f"pbkdf2${it}${salt.hex()}${dk.hex()}"


def verify_pin(pin: str, stored: str) -> bool:
    try:
        _, it_s, salt_hex, hash_hex = stored.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(salt_hex), int(it_s))
        return hmac.compare_digest(dk.hex(), hash_hex)
    except Exception:
        return False


# ----------------------------- lifespan ----------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.open_pool()
    await _ensure_seed_user()
    yield
    await db.close_pool()


async def _ensure_seed_user() -> None:
    row = await db.fetchrow("select id from users limit 1")
    if row is None:
        pin = os.environ.get("INITIAL_PIN")
        if not pin:
            print("[setup] No users and no INITIAL_PIN set — login will fail until a user exists.")
            return
        await db.execute("insert into users (pin_hash) values (%s)", hash_pin(pin))
        print("[setup] Created initial user from INITIAL_PIN.")
    await db.execute(
        "insert into settings (id) values (1) on conflict (id) do nothing"
    )


app = FastAPI(lifespan=lifespan)


# ----------------------------- auth dep ---------------------------------
async def current_user(request: Request) -> str:
    raw = request.cookies.get(COOKIE_NAME)
    if not raw:
        raise HTTPException(401, "no session")
    try:
        data = signer.loads(raw)
    except BadSignature:
        raise HTTPException(401, "bad session")
    uid = data.get("uid")
    row = await db.fetchrow("select id from users where id = %s", uid)
    if row is None:
        raise HTTPException(401, "unknown user")
    return str(row["id"])


# ----------------------------- models ----------------------------------
class LoginIn(BaseModel):
    pin: str


class SessionIn(BaseModel):
    day_id: int
    date: str
    rounds_planned: int
    is_deload: bool = False
    source: str = "timer"
    work_sec: int = 40


class SessionPatch(BaseModel):
    rounds_completed: Optional[int] = None
    duration_sec: Optional[int] = None


class LogItem(BaseModel):
    exercise_id: int
    reps: Optional[int] = None
    round_number: int = 1


class LogsIn(BaseModel):
    logs: list[LogItem]


class MeasurementIn(BaseModel):
    date: str
    weight_kg: Optional[float] = None
    waist_cm: Optional[float] = None
    is_standard_conditions: bool = True
    note: Optional[str] = None


# ----------------------------- routes ---------------------------------
@app.post("/api/login")
async def login(body: LoginIn, response: Response):
    user = await db.fetchrow("select id, pin_hash from users limit 1")
    if user is None or not verify_pin(body.pin, user["pin_hash"]):
        raise HTTPException(401, "PIN incorrecto")
    token = signer.dumps({"uid": str(user["id"])})
    response.set_cookie(
        COOKIE_NAME, token, httponly=True, samesite="lax",
        secure=os.environ.get("COOKIE_SECURE", "1") == "1",
        max_age=60 * 60 * 24 * 180,
    )
    return {"ok": True}


@app.post("/api/logout")
async def logout(response: Response):
    response.delete_cookie(COOKIE_NAME)
    return {"ok": True}


@app.get("/api/me")
async def me(request: Request):
    try:
        await current_user(request)
        return {"authenticated": True}
    except HTTPException:
        return {"authenticated": False}


@app.get("/api/bootstrap")
async def bootstrap(user: str = Depends(current_user)):
    days = await db.fetch("select * from training_days order by sort_order")
    exs = await db.fetch(
        "select * from exercises order by day_id, "
        "case block when 'warmup' then 0 when 'main' then 1 else 2 end, sort_order"
    )
    by_day: dict[int, list] = {}
    for e in exs:
        by_day.setdefault(e["day_id"], []).append(e)
    for d in days:
        d["exercises"] = by_day.get(d["id"], [])
    settings = await db.fetchrow("select * from settings where id = 1")
    return {"days": days, "settings": settings}


@app.get("/api/prefill")
async def prefill(day_id: int, user: str = Depends(current_user)):
    rows = await db.fetch(
        """
        select distinct on (sl.exercise_id) sl.exercise_id, sl.reps
        from session_logs sl
        join sessions s on s.id = sl.session_id
        where s.user_id = %s and s.day_id = %s and sl.reps is not null
        order by sl.exercise_id, s.date desc, s.created_at desc
        """,
        user, day_id,
    )
    return {str(r["exercise_id"]): r["reps"] for r in rows}


@app.post("/api/sessions")
async def create_session(body: SessionIn, user: str = Depends(current_user)):
    row = await db.fetchrow(
        """
        insert into sessions (user_id, day_id, date, started_at, is_deload,
                              rounds_completed, work_sec, source)
        values (%s, %s, %s, now(), %s, %s, %s, %s)
        returning id
        """,
        user, body.day_id, date_cls.fromisoformat(body.date), body.is_deload,
        body.rounds_planned, body.work_sec, body.source,
    )
    return {"id": str(row["id"])}


@app.patch("/api/sessions/{sid}")
async def patch_session(sid: str, body: SessionPatch, user: str = Depends(current_user)):
    await db.execute(
        """
        update sessions set
          rounds_completed = coalesce(%s, rounds_completed),
          duration_sec     = coalesce(%s, duration_sec)
        where id = %s and user_id = %s
        """,
        body.rounds_completed, body.duration_sec, sid, user,
    )
    return {"ok": True}


@app.post("/api/sessions/{sid}/logs")
async def put_logs(sid: str, body: LogsIn, user: str = Depends(current_user)):
    owns = await db.fetchrow("select 1 from sessions where id = %s and user_id = %s", sid, user)
    if owns is None:
        raise HTTPException(404, "sesión no encontrada")
    async with db.conn() as c:
        for it in body.logs:
            await c.execute(
                """
                insert into session_logs (session_id, exercise_id, round_number, reps)
                values (%s, %s, %s, %s)
                on conflict (session_id, exercise_id, round_number)
                do update set reps = excluded.reps
                """,
                (sid, it.exercise_id, it.round_number, it.reps),
            )
    return {"ok": True}


@app.get("/api/sessions")
async def list_sessions(limit: int = 30, user: str = Depends(current_user)):
    return await db.fetch(
        """
        select s.id, s.date, s.day_id, d.name as day_name, s.is_deload,
               s.rounds_completed, s.duration_sec, s.source
        from sessions s join training_days d on d.id = s.day_id
        where s.user_id = %s
        order by s.date desc, s.created_at desc
        limit %s
        """,
        user, limit,
    )


@app.get("/api/measurements")
async def list_measurements(user: str = Depends(current_user)):
    return await db.fetch(
        "select * from body_measurements where user_id = %s order by date",
        user,
    )


@app.post("/api/measurements")
async def add_measurement(body: MeasurementIn, user: str = Depends(current_user)):
    row = await db.fetchrow(
        """
        insert into body_measurements
          (user_id, date, weight_kg, waist_cm, is_standard_conditions, note)
        values (%s, %s, %s, %s, %s, %s)
        on conflict (user_id, date) do update set
          weight_kg = excluded.weight_kg,
          waist_cm  = excluded.waist_cm,
          is_standard_conditions = excluded.is_standard_conditions,
          note = excluded.note
        returning id
        """,
        user, date_cls.fromisoformat(body.date), body.weight_kg, body.waist_cm,
        body.is_standard_conditions, body.note,
    )
    return {"id": str(row["id"])}


@app.get("/api/dashboard")
async def dashboard(user: str = Depends(current_user)):
    goal = await db.fetchrow("select goal_weight_kg from settings where id = 1")
    measurements = await db.fetch(
        """
        select date, weight_kg, waist_cm, is_standard_conditions
        from body_measurements where user_id = %s order by date
        """,
        user,
    )
    sessions = await db.fetch(
        """
        select s.id, s.date, s.day_id, d.name as day_name, s.is_deload, s.source
        from sessions s join training_days d on d.id = s.day_id
        where s.user_id = %s order by s.date
        """,
        user,
    )
    strength = await db.fetch(
        """
        select s.date, s.day_id, s.is_deload, s.work_sec,
               sl.exercise_id, e.name as exercise_name, sl.reps
        from session_logs sl
        join sessions s on s.id = sl.session_id
        join exercises e on e.id = sl.exercise_id
        where s.user_id = %s and sl.reps is not null and sl.round_number = 1
        order by s.date
        """,
        user,
    )
    return {
        "goal_weight_kg": float(goal["goal_weight_kg"]) if goal else 70.0,
        "measurements": measurements,
        "sessions": sessions,
        "strength": strength,
    }


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
