from __future__ import annotations

import os
from contextlib import asynccontextmanager

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

_pool: AsyncConnectionPool | None = None


async def open_pool() -> None:
    global _pool
    dsn = os.environ["DATABASE_URL"]
    _pool = AsyncConnectionPool(dsn, min_size=1, max_size=5, kwargs={"row_factory": dict_row})
    await _pool.wait()


async def close_pool() -> None:
    if _pool is not None:
        await _pool.close()


@asynccontextmanager
async def conn():
    assert _pool is not None, "pool not open"
    async with _pool.connection() as c:
        yield c


async def fetch(sql: str, *args) -> list[dict]:
    async with conn() as c:
        cur = await c.execute(sql, args)
        return await cur.fetchall()


async def fetchrow(sql: str, *args) -> dict | None:
    async with conn() as c:
        cur = await c.execute(sql, args)
        return await cur.fetchone()


async def execute(sql: str, *args) -> None:
    async with conn() as c:
        await c.execute(sql, args)
