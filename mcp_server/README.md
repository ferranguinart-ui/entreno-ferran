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
