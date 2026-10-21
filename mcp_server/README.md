# MCP de entreno

Servidor MCP remoto (Streamable HTTP) sobre la misma BD que la app. Python ≥ 3.10.

```bash
python3.12 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
DATABASE_URL=postgresql://… .venv/bin/uvicorn server:app --port 8021   # /mcp y /health
```

Tests (la BD se BORRA: su nombre debe contener "test"):

```bash
TEST_DATABASE_URL=postgresql://…/entreno_mcp_test .venv/bin/pytest
```

Probar con MCP Inspector (servidor arrancado en :8021):

```bash
npx @modelcontextprotocol/inspector                       # UI: Transport "Streamable HTTP", URL http://127.0.0.1:8021/mcp
npx @modelcontextprotocol/inspector --cli http://127.0.0.1:8021/mcp --transport http --method tools/list
npx @modelcontextprotocol/inspector --cli http://127.0.0.1:8021/mcp --transport http --method tools/call --tool-name get_targets --tool-arg day=empuje
```

En producción: `MCP_ALLOWED_HOSTS=mcp.ferranguinart.com` (si no, el SDK responde 421).

## Autenticación (OAuth 2.1, `auth.py`)

Siempre activa. Solo acepta a Claude (CIMD `https://claude.ai/oauth/mcp-oauth-client-metadata`,
vuelta a `https://claude.ai/api/mcp/auth_callback`); Claude Code solo con `MCP_ALLOW_CLAUDE_CODE=1`.
Pantalla de autorización con contraseña; en el entorno solo su hash:

```bash
.venv/bin/python auth.py hash-password     # → MCP_PASSWORD_HASH=pbkdf2:...
```

`mcp_server/.env` (fuera del repo, chmod 600): `MCP_PUBLIC_URL`, `MCP_ALLOWED_HOSTS`, `MCP_PASSWORD_HASH`.
`DATABASE_URL` se toma de `backend/.env`.

## Despliegue

Una sola vez, como root en el VPS: `sudo bash /srv/entreno/deploy/setup-mcp.sh`
(venv, esquema, contraseña, servicio `entreno-mcp`, nginx y certificado). Después, cada push
a main lo actualiza `deploy/update.sh` junto con la app.
