"""OAuth 2.1 mínimo para un solo usuario (Ferran), según la autorización MCP vigente
y lo que exige Claude (docs de conectores, 2026-10):

- Claude se identifica con su Client ID Metadata Document (CIMD). En vez de ir a
  buscar cualquier URL (SSRF), solo aceptamos los client_id de Claude, con sus
  redirect_uri copiados de esos documentos: lista cerrada.
- Authorization code + PKCE S256 obligatorio, `resource` (RFC 8707) = este servidor,
  `iss` en la respuesta (RFC 9207). Cliente público: sin secreto.
- Pantalla de autorización con la contraseña de Ferran (hash PBKDF2 en el entorno).
- Tokens opacos aleatorios; en la BD solo su SHA-256. Access 1 h, refresh 60 días
  con rotación; reutilizar un refresh/código revoca toda la familia.

Generar el hash de la contraseña:  python auth.py hash-password
"""
from __future__ import annotations

import base64
import getpass
import hashlib
import hmac
import html
import os
import re
import secrets
import sys
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, urlsplit

from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, RedirectResponse, Response

SCOPE = "entreno"
CODE_TTL = timedelta(minutes=5)
ACCESS_TTL = timedelta(hours=1)
REFRESH_TTL = timedelta(days=60)
PBKDF2_ITERATIONS = 600_000

# client_id (URL del CIMD) → datos copiados de ese documento.
CLAUDE_WEB = "https://claude.ai/oauth/mcp-oauth-client-metadata"
CLAUDE_CODE = "https://claude.ai/oauth/claude-code-client-metadata"
CLIENTS = {
    CLAUDE_WEB: {"name": "Claude (web, escritorio y móvil)", "redirect_uris": ["https://claude.ai/api/mcp/auth_callback"]},
    CLAUDE_CODE: {"name": "Claude Code (este ordenador)", "loopback": ["/callback"]},
}


def base_url() -> str:
    return os.environ.get("MCP_PUBLIC_URL", "http://127.0.0.1:8021").rstrip("/")


def resource_url() -> str:
    return f"{base_url()}/mcp"


def allowed_clients() -> dict:
    # Claude Code (redirect a localhost) solo si se activa a propósito.
    return {k: v for k, v in CLIENTS.items() if k != CLAUDE_CODE or os.environ.get("MCP_ALLOW_CLAUDE_CODE") == "1"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _sha(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# ------------------------------- contraseña ----------------------------------
def hash_password(pw: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, PBKDF2_ITERATIONS)
    # ":" y no "$": el .env se lee con shell/dotenv y "$" se expandiría
    return f"pbkdf2:{PBKDF2_ITERATIONS}:{salt.hex()}:{dk.hex()}"


def verify_password(pw: str) -> bool:
    stored = os.environ.get("MCP_PASSWORD_HASH", "")
    try:
        _, it, salt, want = stored.replace("$", ":").split(":")
        dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), int(it))
        return hmac.compare_digest(dk.hex(), want)
    except ValueError:
        return False  # sin hash configurado: nadie entra


# ------------------------------ rate limiting --------------------------------
class Limiter:
    """Ventana deslizante en memoria (un solo proceso)."""

    def __init__(self, limit: int, per_sec: int):
        self.limit, self.per = limit, per_sec
        self.hits: dict[str, deque] = defaultdict(deque)

    def blocked(self, key: str) -> bool:
        q, t = self.hits.get(key), time.monotonic()
        if q is None:
            return False
        while q and t - q[0] > self.per:
            q.popleft()
        if not q:
            del self.hits[key]  # sin esto, cada IP nueva se quedaría en memoria para siempre
            return False
        return len(q) >= self.limit

    def hit(self, key: str) -> None:
        self.hits[key].append(time.monotonic())

    def reset(self) -> None:
        self.hits.clear()


FAILS_IP = Limiter(5, 15 * 60)      # 5 contraseñas mal por IP cada 15 min
FAILS_ALL = Limiter(100, 60 * 60)   # 100 por hora en total (muy por encima de lo que llega una IP: 20/h)
TOKEN_IP = Limiter(60, 60)          # /token: 60 por minuto e IP


def _ip(request: Request) -> str:
    return request.client.host if request.client else "?"


# ------------------------------- metadatos -----------------------------------
async def as_metadata(_request: Request) -> JSONResponse:
    b = base_url()
    return JSONResponse({
        "issuer": b,
        "authorization_endpoint": f"{b}/authorize",
        "token_endpoint": f"{b}/token",
        "scopes_supported": [SCOPE],
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "token_endpoint_auth_methods_supported": ["none"],
        "code_challenge_methods_supported": ["S256"],
        "client_id_metadata_document_supported": True,
        "authorization_response_iss_parameter_supported": True,
    })


# ------------------------------- /authorize ----------------------------------
LOOPBACK = re.compile(r"http://(?:localhost|127\.0\.0\.1):\d{1,5}(/[A-Za-z0-9/_-]*)")


def _redirect_ok(client: dict, uri: str) -> bool:
    if uri in client.get("redirect_uris", []):
        return True
    # loopback: cualquier puerto (RFC 8252 §7.3). Regex estricta y no urlsplit:
    # "http://evil.com\@localhost/callback" engaña a urlsplit y el navegador iría a evil.com.
    m = LOOPBACK.fullmatch(uri)
    return bool(client.get("loopback")) and bool(m) and m.group(1) in client["loopback"]


def _with_params(uri: str, **params) -> str:
    return uri + ("&" if "?" in uri else "?") + urlencode({k: v for k, v in params.items() if v is not None})


def _validate(p) -> tuple[dict | None, str | None, Response | None]:
    """→ (cliente, redirect_uri, respuesta de error). Sin cliente/redirect válidos NO se redirige."""
    client = allowed_clients().get(p.get("client_id", ""))
    redirect_uri = p.get("redirect_uri", "")
    if not client or not _redirect_ok(client, redirect_uri):
        return None, None, _page("Solicitud no válida", "<p>Esta aplicación o su dirección de retorno no están autorizadas.</p>", 400)

    def back(error, desc):
        return None, None, RedirectResponse(
            _with_params(redirect_uri, error=error, error_description=desc, state=p.get("state"), iss=base_url()), 302)

    if p.get("response_type") != "code":
        return back("unsupported_response_type", "solo response_type=code")
    if p.get("code_challenge_method") != "S256" or not p.get("code_challenge"):
        return back("invalid_request", "PKCE S256 obligatorio")
    if p.get("resource") and p["resource"].rstrip("/") != resource_url():
        return back("invalid_target", f"resource debe ser {resource_url()}")
    scopes = set((p.get("scope") or SCOPE).split())
    if not scopes <= {SCOPE, "offline_access"}:
        return back("invalid_scope", f"scope permitido: {SCOPE}")
    return client, redirect_uri, None


FIELDS = ("response_type", "client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "scope", "resource")


async def authorize_get(request: Request) -> Response:
    p = dict(request.query_params)
    client, redirect_uri, error = _validate(p)
    return error or _consent(p, client, redirect_uri)


async def authorize_post(request: Request) -> Response:
    form = await request.form()
    p = {k: str(form.get(k)) for k in FIELDS if form.get(k) is not None}
    client, redirect_uri, error = _validate(p)
    if error:
        return error
    if form.get("action") != "allow":
        return RedirectResponse(_with_params(redirect_uri, error="access_denied", state=p.get("state"), iss=base_url()), 302)
    ip = _ip(request)
    if FAILS_IP.blocked(ip) or FAILS_ALL.blocked("*"):
        return _consent(p, client, redirect_uri, "Demasiados intentos. Espera unos minutos.", 429)
    if not verify_password(str(form.get("password", ""))):
        FAILS_IP.hit(ip)
        FAILS_ALL.hit("*")
        return _consent(p, client, redirect_uri, "Contraseña incorrecta.", 401)
    code = secrets.token_urlsafe(32)
    await _store(code, "code", uuid.uuid4(), p["client_id"], SCOPE, resource_url(), CODE_TTL,
                 redirect_uri=redirect_uri, code_challenge=p["code_challenge"])
    return RedirectResponse(_with_params(redirect_uri, code=code, state=p.get("state"), iss=base_url()), 302)


# --------------------------------- /token ------------------------------------
def _tok_error(error: str, desc: str, status: int = 400) -> JSONResponse:
    return JSONResponse({"error": error, "error_description": desc}, status,
                        headers={"Cache-Control": "no-store", "Pragma": "no-cache"})


async def token(request: Request) -> Response:
    ip = _ip(request)
    if TOKEN_IP.blocked(ip):
        r = _tok_error("invalid_request", "demasiadas peticiones; reintenta en un minuto", 429)
        r.headers["Retry-After"] = "60"
        return r
    TOKEN_IP.hit(ip)
    f = await request.form()
    grant, client_id = f.get("grant_type"), f.get("client_id", "")
    if client_id not in allowed_clients():
        return _tok_error("invalid_client", "cliente no autorizado", 401)
    if f.get("resource") and str(f["resource"]).rstrip("/") != resource_url():
        return _tok_error("invalid_target", f"resource debe ser {resource_url()}")

    if grant == "authorization_code":
        row = await _consume(str(f.get("code", "")), "code", client_id)
        if row is None or row["redirect_uri"] != f.get("redirect_uri"):
            return _tok_error("invalid_grant", "código no válido, caducado o ya usado")
        challenge = base64.urlsafe_b64encode(hashlib.sha256(str(f.get("code_verifier", "")).encode()).digest()).rstrip(b"=").decode()
        if not hmac.compare_digest(challenge, row["code_challenge"]):
            await _revoke_family(row["family"])
            return _tok_error("invalid_grant", "PKCE: code_verifier no coincide")
        return await _issue(row["family"], client_id)

    if grant == "refresh_token":
        row = await _consume(str(f.get("refresh_token", "")), "refresh", client_id)
        if row is None:
            return _tok_error("invalid_grant", "refresh token no válido, caducado o revocado")
        return await _issue(row["family"], client_id)

    return _tok_error("unsupported_grant_type", "usa authorization_code o refresh_token")


# --------------------------------- BD ----------------------------------------
async def _store(tok: str, kind: str, family, client_id: str, scope: str, resource: str, ttl: timedelta,
                 redirect_uri: str | None = None, code_challenge: str | None = None) -> None:
    import db

    await db.execute(
        "insert into mcp_tokens (token_hash, kind, family, client_id, scope, resource, redirect_uri, code_challenge, expires_at) "
        "values (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
        _sha(tok), kind, family, client_id, scope, resource, redirect_uri, code_challenge, _now() + ttl,
    )


# Una familia revocada queda muerta entera, también los tokens emitidos después
# de revocarla (carrera: el que gana el código emite mientras el otro revoca).
ALIVE = "not exists (select 1 from mcp_tokens r where r.family = mcp_tokens.family and r.revoked_at is not null)"


async def _consume(tok: str, kind: str, client_id: str) -> dict | None:
    """Marca como usado un código/refresh válido y lo devuelve. Si ya estaba usado,
    alguien lo ha reutilizado (¿robo?): se revoca la familia entera."""
    import db

    if not tok:
        return None
    row = await db.fetchrow(
        "update mcp_tokens set used_at = now() where token_hash = %s and kind = %s and client_id = %s "
        f"and used_at is null and expires_at > now() and {ALIVE} returning *",
        _sha(tok), kind, client_id,
    )
    if row is None:
        old = await db.fetchrow("select family, used_at from mcp_tokens where token_hash = %s and kind = %s", _sha(tok), kind)
        if old and old["used_at"] is not None:
            await _revoke_family(old["family"])
    return row


async def _revoke_family(family) -> None:
    import db

    await db.execute("update mcp_tokens set revoked_at = now() where family = %s and revoked_at is null", family)


async def _issue(family, client_id: str) -> JSONResponse:
    import db

    access, refresh = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    await _store(access, "access", family, client_id, SCOPE, resource_url(), ACCESS_TTL)
    await _store(refresh, "refresh", family, client_id, SCOPE, resource_url(), REFRESH_TTL)
    await db.execute("delete from mcp_tokens where expires_at < now() - interval '7 days'")
    return JSONResponse(
        {"access_token": access, "token_type": "Bearer", "expires_in": int(ACCESS_TTL.total_seconds()),
         "refresh_token": refresh, "scope": SCOPE},
        headers={"Cache-Control": "no-store", "Pragma": "no-cache"},
    )


class DbTokenVerifier:
    """TokenVerifier del SDK: token opaco → fila de mcp_tokens."""

    async def verify_token(self, tok: str):
        import db
        from mcp.server.auth.provider import AccessToken

        row = await db.fetchrow(
            f"select * from mcp_tokens where token_hash = %s and kind = 'access' and expires_at > now() and {ALIVE}",
            _sha(tok),
        )
        if row is None:
            return None
        return AccessToken(token=tok, client_id=row["client_id"], scopes=row["scope"].split(),
                           expires_at=int(row["expires_at"].timestamp()), resource=row["resource"])


# ------------------------------ pantalla -------------------------------------
STYLE = """
:root{color-scheme:dark;--bg:#0b0f14;--card:#141a22;--line:#243041;--ink:#e8edf3;--mut:#93a1b3;--work:#2fd47e;--bad:#ff6b6b}
*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;background:var(--bg);
color:var(--ink);font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:16px}
.card{width:100%;max-width:380px;background:var(--card);border:1px solid var(--line);border-radius:20px;padding:24px}
h1{font-size:20px;margin:0 0 8px}p{color:var(--mut);margin:0 0 14px}b{color:var(--ink)}
.host{display:inline-block;padding:2px 8px;border-radius:8px;background:#0f141b;border:1px solid var(--line);color:var(--ink)}
label{display:block;font-size:14px;color:var(--mut);margin:16px 0 6px}
input[type=password]{width:100%;padding:14px;border-radius:12px;border:1px solid var(--line);background:#0f141b;color:var(--ink);font-size:16px}
.row{display:flex;gap:10px;margin-top:18px}button{flex:1;min-height:48px;border-radius:14px;border:1px solid var(--line);
font:600 16px system-ui,sans-serif;cursor:pointer;background:transparent;color:var(--ink)}
button.ok{background:var(--work);border-color:var(--work);color:#04210f}.err{color:var(--bad);margin-top:12px}
"""


def _page(title: str, body: str, status: int = 200) -> HTMLResponse:
    doc = (f'<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
           f'<title>{html.escape(title)}</title><style>{STYLE}</style></head><body><main class="card"><h1>{html.escape(title)}</h1>{body}</main></body></html>')
    return HTMLResponse(doc, status, headers={
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
        "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store",
    })


def _consent(p: dict, client: dict, redirect_uri: str, error: str = "", status: int = 200) -> HTMLResponse:
    hidden = "".join(f'<input type="hidden" name="{k}" value="{html.escape(str(p[k]))}">' for k in FIELDS if p.get(k))
    host = urlsplit(redirect_uri).netloc
    warn = "<p>Vuelve a una dirección local de este ordenador.</p>" if client.get("loopback") else ""
    body = (f'<p><b>{html.escape(client["name"])}</b> quiere leer y registrar tus datos de entreno y peso.</p>'
            f'<p>Volverás a <span class="host">{html.escape(host)}</span></p>{warn}'
            f'<form method="post" action="/authorize">{hidden}'
            f'<label for="pw">Contraseña</label><input id="pw" name="password" type="password" autocomplete="current-password" autofocus required>'
            + (f'<p class="err" role="alert">{html.escape(error)}</p>' if error else "")
            + '<div class="row"><button name="action" value="deny" formnovalidate>Cancelar</button>'
            '<button class="ok" name="action" value="allow">Autorizar</button></div></form>')
    return _page("Conectar con Entreno", body, status)


if __name__ == "__main__" and sys.argv[1:] == ["hash-password"]:
    a = getpass.getpass("Contraseña nueva: ")
    if len(a) < 12:
        sys.exit("Mínimo 12 caracteres.")
    if a != getpass.getpass("Repítela: "):
        sys.exit("No coinciden.")
    print(hash_password(a))
