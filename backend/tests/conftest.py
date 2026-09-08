"""Fixtures de test. Requiere un PostgreSQL de usar y tirar en DATABASE_URL
(el workflow de CI levanta uno como service). Sin DATABASE_URL, los tests se
saltan en vez de fallar."""
import os
import pathlib
import subprocess
import sys

import pytest

os.environ.setdefault("SESSION_SECRET", "test-secret")
os.environ.setdefault("COOKIE_SECURE", "0")
os.environ.setdefault("INITIAL_PIN", "4321")

ROOT = pathlib.Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"


def _psql(db_url: str, *args: str) -> None:
    subprocess.run(["psql", db_url, "-v", "ON_ERROR_STOP=1", "-q", *args], check=True)


@pytest.fixture(scope="session")
def app_mod():
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        pytest.skip("sin DATABASE_URL")
    _psql(db_url, "-c", "drop schema if exists public cascade; create schema public;")
    _psql(db_url, "-f", str(ROOT / "db" / "schema.sql"))
    _psql(db_url, "-f", str(ROOT / "db" / "seed.sql"))
    sys.path.insert(0, str(BACKEND))
    import app  # noqa: E402

    return app


@pytest.fixture
def client(app_mod):
    from fastapi.testclient import TestClient

    with TestClient(app_mod.app) as c:
        yield c


@pytest.fixture
def auth_client(client):
    r = client.post("/api/login", json={"pin": os.environ["INITIAL_PIN"]})
    assert r.status_code == 200
    return client
