"""Servidor MCP de entreno.ferranguinart.com (Streamable HTTP).

Lee y escribe en la misma BD que la app (única fuente de verdad); solo añade audit_log. Arranque local:
  DATABASE_URL=... .venv/bin/uvicorn server:app --port 8021
Endpoint MCP: /mcp · salud: /health
"""
from __future__ import annotations

import json
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit
from typing import Annotated, Any, Literal

from dotenv import load_dotenv
from pydantic import BaseModel, Field
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.routing import Mount
from starlette.responses import JSONResponse

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import db  # noqa: E402  (backend/db.py: el mismo pool que la app)

from mcp.server.auth.settings import AuthSettings  # noqa: E402
from mcp.server.mcpserver import MCPServer  # noqa: E402
from mcp.server.mcpserver.exceptions import ToolError  # noqa: E402
from mcp.server.transport_security import TransportSecuritySettings  # noqa: E402
from mcp.types import ToolAnnotations  # noqa: E402

import auth  # noqa: E402
import queries as q  # noqa: E402
import writes as w  # noqa: E402

load_dotenv(Path(__file__).with_name(".env"))
load_dotenv(Path(__file__).resolve().parents[1] / "backend" / ".env")


mcp = MCPServer(
    "entreno",
    title="Entreno de Ferran",
    instructions=(
        "Datos de entrenamiento y peso corporal de Ferran (app entreno.ferranguinart.com). "
        "Fechas en YYYY-MM-DD, zona horaria Europe/Madrid; semanas de lunes a domingo. "
        "Peso corporal en kg. Kg de ejercicio = solo discos (las barras de las mancuernas pesan ~0): "
        "en material 'pair' es el peso POR mancuerna. Para saber si toca subir o bajar peso usa get_targets."
    ),
    # Siempre con OAuth: no hay modo sin autenticación (ver auth.py).
    token_verifier=auth.DbTokenVerifier(),
    auth=AuthSettings(
        issuer_url=auth.base_url(),
        resource_server_url=auth.resource_url(),
        required_scopes=[auth.SCOPE],
        validate_token_resource=True,
    ),

)

READ = ToolAnnotations(read_only_hint=True, open_world_hint=False)
WRITE = ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=False, open_world_hint=False)
EDIT = ToolAnnotations(read_only_hint=False, destructive_hint=True, idempotent_hint=True, open_world_hint=False)

Date = Annotated[str | None, Field(description="Fecha YYYY-MM-DD (Europe/Madrid). Opcional.")]


async def _run(coro) -> str:
    """JSON compacto (menos tokens); los errores de uso vuelven como error legible."""
    try:
        return json.dumps(await coro, ensure_ascii=False, separators=(",", ":"))
    except q.UserError as e:
        raise ToolError(str(e)) from e


@mcp.tool(structured_output=False, annotations=READ)
async def get_summary() -> str:
    """Estado actual de Ferran en una sola llamada: último peso (kg) y su fecha, media móvil
    de los últimos 7 registros, mínimo histórico, objetivo y kg que faltan; sesiones hechas esta
    semana (lunes a domingo, días distintos) frente al objetivo de 4; y la última sesión de cada
    día del plan con los días que han pasado. Úsala primero para preguntas generales de progreso."""
    return await _run(q.get_summary())


@mcp.tool(structured_output=False, annotations=READ)
async def get_measurements(from_date: Date = None, to_date: Date = None) -> str:
    """Registros de peso corporal (kg) con fecha, id y si se tomó en condiciones estándar
    (en ayunas, primera hora). standard_conditions=false = medida poco fiable para tendencias.
    Sin fechas: últimos 90 días hasta hoy."""
    return await _run(q.get_measurements(from_date, to_date))


@mcp.tool(structured_output=False, annotations=READ)
async def get_sessions(
    from_date: Date = None,
    to_date: Date = None,
    day: Annotated[str | None, Field(description="Día del plan: nombre ('Empuje', 'Tracción', 'HIIT', 'Piernas', 'Libre') o número ('día 1'). Opcional.")] = None,
) -> str:
    """Sesiones de entrenamiento con día del plan, deload sí/no, rondas completadas, duración
    (minutos), origen (timer/manual), notas y, por ejercicio, cada ronda con reps y kg
    (kg solo discos; en 'pair' es POR mancuerna). Solo aparecen los ejercicios con algo apuntado.
    Sin fechas: últimos 90 días."""
    return await _run(q.get_sessions(from_date, to_date, day))


@mcp.tool(structured_output=False, annotations=READ)
async def get_plan() -> str:
    """Definición del plan: calentamiento compartido y los días (Empuje, HIIT + core, Tracción,
    Piernas + core, Libre) con rondas (por defecto, rango y deload), descansos en segundos y
    ejercicios (bloque main/remate/stretch = estiramientos finales, segundos de trabajo, músculos,
    material, rango de reps objetivo).
    Úsala para nombres exactos de días y ejercicios."""
    return await _run(q.get_plan())


@mcp.tool(structured_output=False, annotations=READ)
async def get_targets(
    day: Annotated[str, Field(description="Día del plan: nombre ('Empuje', 'Tracción'…) o número ('día 3').")],
) -> str:
    """'Hoy toca' para un día del plan, con la misma regla de doble progresión que la app:
    por ejercicio, la acción (start = elegir peso, hold = mantener, up = subir, down = bajar),
    el kg recomendado y el anterior (from), qué discos poner por lado, el rango de reps y la
    última sesión (fecha, kg, reps por ronda). Úsala para aconsejar cuándo subir o bajar peso."""
    return await _run(q.get_targets(day))


# ------------------------------- escrituras ----------------------------------
async def _audited(tool: str, args: dict, coro) -> str:
    """Toda escritura queda en audit_log (también las rechazadas), con datos y resultado."""
    try:
        result = await coro
    except q.UserError as e:
        await _audit(tool, args, False, {"error": str(e)})
        raise ToolError(str(e)) from e
    except Exception as e:
        await _audit(tool, args, False, {"error": f"interno: {type(e).__name__}"})
        raise
    await _audit(tool, args, True, result)
    return json.dumps(result, ensure_ascii=False, separators=(",", ":"))


async def _audit(tool: str, args: dict, ok: bool, result: Any) -> None:
    """Best-effort: si la auditoría falla, la respuesta de la herramienta no cambia
    (el dato ya está guardado o el error original es el que Claude debe leer)."""
    dump = lambda v: json.dumps(v, ensure_ascii=False, default=str)  # noqa: E731
    try:
        await db.execute(
            "insert into audit_log (tool, args, ok, result) values (%s, %s::jsonb, %s, %s::jsonb)",
            tool, dump(args), ok, dump(result),
        )
    except Exception as e:  # noqa: BLE001
        print(f"[audit] no se pudo registrar {tool}: {type(e).__name__}: {e}", file=sys.stderr)


class SetIn(BaseModel):
    """Una ronda de un ejercicio."""
    # float (no int) para que un valor raro llegue a writes.py: error legible y auditado.
    reps: float | None = Field(None, description="Repeticiones de la ronda, número entero (0–100). Omitir en isométricos.")
    kg: float | None = Field(
        None,
        description="Kg de discos de la ronda. 'pair' = POR mancuerna; 'single'/'bar' = toda la carga. "
        "Omitir en peso corporal o si no se apuntó. Debe ser montable con los discos.",
    )


class ExerciseIn(BaseModel):
    name: str = Field(description="Nombre del ejercicio del día (ver get_plan); tolera tildes y mayúsculas.")
    sets: list[SetIn] = Field(description="Rondas en orden: la primera es la ronda 1.")


@mcp.tool(structured_output=False, annotations=WRITE)
async def log_weight(
    date: Annotated[str, Field(description="Fecha del pesaje YYYY-MM-DD (no futura, desde 2026-01-01).")],
    weight_kg: Annotated[float, Field(description="Peso corporal en kg (60–95), un decimal.")],
    standard_conditions: Annotated[bool, Field(description="true = en ayunas, primera hora, tras baño. false si no.")] = True,
    note: Annotated[str | None, Field(description="Nota opcional.")] = None,
) -> str:
    """Guarda un peso corporal. Si ya hay peso ese día NO lo sobrescribe: devuelve error con el
    registro existente y su id para usar update_entry. Devuelve el registro guardado con su id."""
    args = {"date": date, "weight_kg": weight_kg, "standard_conditions": standard_conditions, "note": note}
    return await _audited("log_weight", args, w.log_weight(date, weight_kg, standard_conditions, note))


@mcp.tool(structured_output=False, annotations=WRITE)
async def log_session(
    date: Annotated[str, Field(description="Fecha del entreno YYYY-MM-DD (no futura, desde 2026-01-01).")],
    day: Annotated[str, Field(description="Día del plan: 'Empuje', 'HIIT', 'Tracción', 'Piernas', 'Libre' o 'día N'.")],
    exercises: Annotated[list[ExerciseIn], Field(description="Ejercicios hechos con sus rondas. Puede ir vacío (p. ej. día Libre).")],
    duration_min: Annotated[float | None, Field(description="Duración total en minutos (1–300). Opcional.")] = None,
    rounds: Annotated[int | None, Field(description="Rondas completadas (1–10). Si se omite: las del plan para ese día (o las de deload), o más si se dictan más.")] = None,
    deload: Annotated[bool, Field(description="true si fue semana/sesión de descarga.")] = False,
    note: Annotated[str | None, Field(description="Nota opcional de la sesión.")] = None,
) -> str:
    """Registra un entreno dictado: día del plan, y por ejercicio cada ronda con reps y kg.
    Valida reps (0–100), que los kg se puedan montar con los discos de Ferran y que los
    ejercicios sean de ese día (si no, devuelve la lista válida). Si ya hay una sesión de ese
    día en esa fecha devuelve error con su id (usar update_entry). Devuelve la sesión guardada."""
    ex = [e.model_dump() for e in exercises]
    args = {"date": date, "day": day, "exercises": ex, "duration_min": duration_min, "rounds": rounds,
            "deload": deload, "note": note}
    return await _audited("log_session", args, w.log_session(date, day, ex, duration_min, deload, note, rounds))


@mcp.tool(structured_output=False, annotations=EDIT)
async def update_entry(
    type: Annotated[Literal["weight", "session"], Field(description="'weight' (peso corporal) o 'session' (entreno).")],
    id: Annotated[str, Field(description="id del registro (de get_measurements / get_sessions o de la escritura).")],
    fields: Annotated[dict[str, Any], Field(description=(
        "Campos a cambiar. weight: date, weight_kg, standard_conditions, note. "
        "session: date, deload, duration_min, rounds, note, exercises ([{name, sets:[{reps, kg}]}] — "
        "reemplaza las rondas SOLO de los ejercicios que pases; el resto no se toca)."
    ))],
) -> str:
    """Corrige un registro existente con las mismas validaciones que al crearlo.
    Devuelve el registro antes y después del cambio."""
    return await _audited("update_entry", {"type": type, "id": id, "fields": fields}, w.update_entry(type, id, fields))


@mcp.tool(structured_output=False, annotations=EDIT)
async def delete_entry(
    type: Annotated[Literal["weight", "session"], Field(description="'weight' o 'session'.")],
    id: Annotated[str, Field(description="id del registro a borrar.")],
) -> str:
    """Borra un peso o una sesión (con todas sus rondas). Irreversible: confirma con Ferran
    antes de llamarla. Devuelve el registro borrado."""
    return await _audited("delete_entry", {"type": type, "id": id}, w.delete_entry(type, id))


# Servidor de autorización (rutas sin auth del SDK, como debe ser).
mcp.custom_route("/.well-known/oauth-authorization-server", methods=["GET"])(auth.as_metadata)
mcp.custom_route("/authorize", methods=["GET"])(auth.authorize_get)
mcp.custom_route("/authorize", methods=["POST"])(auth.authorize_post)
mcp.custom_route("/token", methods=["POST"])(auth.token)


@mcp.custom_route("/health", methods=["GET"])
async def health(_request: Request) -> JSONResponse:
    try:
        await db.fetchrow("select 1 as ok")
        return JSONResponse({"status": "ok", "db": "ok"})
    except Exception:
        return JSONResponse({"status": "error", "db": "unreachable"}, status_code=503)


def create_app() -> Starlette:
    """App ASGI completa. Una nueva por arranque: el session manager del SDK es de un solo uso."""
    public = urlsplit(auth.base_url()).netloc
    hosts = [h for h in os.environ.get("MCP_ALLOWED_HOSTS", "").split(",") if h] + [public]
    mcp_app = mcp.streamable_http_app(
        stateless_http=True,
        json_response=True,
        transport_security=TransportSecuritySettings(
            allowed_hosts=hosts + ["127.0.0.1:*", "localhost:*"],
            allowed_origins=["http://127.0.0.1:*", "http://localhost:*"],
        ),
    )
    manager = mcp.session_manager

    @asynccontextmanager
    async def lifespan(_app):
        # Un solo pool para todo el proceso (el lifespan de MCPServer iría por petición).
        await db.open_pool()
        try:
            async with manager.run():
                yield
        finally:
            await db.close_pool()

    app = Starlette(routes=[Mount("/", app=mcp_app)], lifespan=lifespan)
    app.state.mcp_app = mcp_app
    return app


app = create_app()
