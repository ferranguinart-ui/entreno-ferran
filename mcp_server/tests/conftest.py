"""BD de usar y tirar (TEST_DATABASE_URL): schema + seed de la app y unos datos de ejemplo.
Se BORRA entera, así que solo se acepta una BD cuyo nombre contenga "test"; nunca
se usa DATABASE_URL (server.py carga el .env de producción). Sin ella, se saltan."""
import os
import pathlib
import subprocess
from datetime import timedelta
from urllib.parse import urlparse

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]


def _psql(url, *args, input=None):
    r = subprocess.run(["psql", url, "-v", "ON_ERROR_STOP=1", "-q", *args], capture_output=True, text=True, input=input)
    if r.returncode:
        raise RuntimeError(r.stderr)


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture(scope="session")
def db_url():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("sin TEST_DATABASE_URL")
    if "test" not in urlparse(url).path:
        pytest.exit(f"TEST_DATABASE_URL debe apuntar a una BD de test (nombre con 'test'): {url}", 2)
    _psql(url, "-c", "drop schema if exists public cascade; create schema public;")
    _psql(url, "-f", str(ROOT / "db" / "schema.sql"))
    _psql(url, "-f", str(ROOT / "db" / "seed.sql"))
    return url


@pytest.fixture
def today():
    import queries

    return queries.today()


@pytest.fixture
async def pool(db_url, today):
    """Pool abierto + datos de ejemplo frescos en cada test."""
    import db

    t = today
    d = lambda n: (t - timedelta(days=n)).isoformat()  # noqa: E731
    _psql(db_url, input=f"""
      truncate users, body_measurements, sessions, session_logs, audit_log cascade;
      insert into users (id, pin_hash) values ('00000000-0000-0000-0000-000000000001', 'x');
      insert into settings (id, goal_weight_kg) values (1, 70) on conflict do nothing;
      insert into body_measurements (user_id, date, weight_kg, is_standard_conditions, note) values
        ('00000000-0000-0000-0000-000000000001', '{d(200)}', 80.0, true, null),
        ('00000000-0000-0000-0000-000000000001', '{d(20)}', 76.4, true, null),
        ('00000000-0000-0000-0000-000000000001', '{d(10)}', 75.8, false, 'después de cenar'),
        ('00000000-0000-0000-0000-000000000001', '{d(1)}', 75.2, true, null);
      insert into sessions (id, user_id, day_id, date, is_deload, rounds_completed, duration_sec, source) values
        ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 1, '{d(14)}', false, 3, 1080, 'timer'),
        ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 1, '{d(7)}', false, 3, 1100, 'timer'),
        ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 3, '{d(0)}', false, 3, null, 'manual');
      insert into session_logs (session_id, exercise_id, round_number, reps, weight_kg) values
        ('10000000-0000-0000-0000-000000000001', 10, 1, 14, 8), ('10000000-0000-0000-0000-000000000001', 10, 2, 14, 8),
        ('10000000-0000-0000-0000-000000000002', 10, 1, 15, 8), ('10000000-0000-0000-0000-000000000002', 10, 2, 14, 8),
        ('10000000-0000-0000-0000-000000000002', 11, 1, null, null),
        ('10000000-0000-0000-0000-000000000003', 30, 1, 12, 10);
    """)
    os.environ["DATABASE_URL"] = db_url
    await db.open_pool()
    yield
    await db.close_pool()
