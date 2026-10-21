"""OAuth de punta a punta como lo hace claude.ai: 401 → metadatos → /authorize con
PKCE → contraseña → código → /token → /mcp con Bearer → refresh con rotación."""
import base64
import hashlib
import secrets
from urllib.parse import parse_qs, urlsplit

import pytest

import auth

PW = "una-contraseña-larga-de-prueba"
CB = "https://claude.ai/api/mcp/auth_callback"
MCP_HEADERS = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
LIST = {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}


@pytest.fixture
def c(db_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", db_url)
    monkeypatch.setenv("MCP_PASSWORD_HASH", auth.hash_password(PW))
    for lim in (auth.FAILS_IP, auth.FAILS_ALL, auth.TOKEN_IP):
        lim.reset()
    from starlette.testclient import TestClient

    import server

    with TestClient(server.create_app(), base_url="http://127.0.0.1:8021") as client:
        yield client


def pkce():
    v = secrets.token_urlsafe(48)
    ch = base64.urlsafe_b64encode(hashlib.sha256(v.encode()).digest()).rstrip(b"=").decode()
    return v, ch


def auth_params(ch, **kw):
    return {"response_type": "code", "client_id": auth.CLAUDE_WEB, "redirect_uri": CB, "state": "st4te",
            "code_challenge": ch, "code_challenge_method": "S256", "scope": "entreno",
            "resource": "http://127.0.0.1:8021/mcp", **kw}


def login(c, ch, pw=PW, **kw):
    return c.post("/authorize", data={**auth_params(ch, **kw), "password": pw, "action": "allow"}, follow_redirects=False)


def code_from(r):
    assert r.status_code == 302, r.text
    q = parse_qs(urlsplit(r.headers["location"]).query)
    assert q["state"] == ["st4te"] and q["iss"] == ["http://127.0.0.1:8021"]
    return q["code"][0]


def exchange(c, code, verifier, **kw):
    return c.post("/token", data={"grant_type": "authorization_code", "code": code, "code_verifier": verifier,
                                  "client_id": auth.CLAUDE_WEB, "redirect_uri": CB,
                                  "resource": "http://127.0.0.1:8021/mcp", **kw})


def tokens(c):
    v, ch = pkce()
    r = exchange(c, code_from(login(c, ch)), v)
    assert r.status_code == 200, r.text
    return r.json()


def test_sin_token_401_con_metadatos(c):
    r = c.post("/mcp", json=LIST, headers=MCP_HEADERS)
    assert r.status_code == 401
    assert 'resource_metadata="http://127.0.0.1:8021/.well-known/oauth-protected-resource/mcp"' in r.headers["www-authenticate"]
    prm = c.get("/.well-known/oauth-protected-resource/mcp").json()
    assert prm["resource"] == "http://127.0.0.1:8021/mcp"
    assert prm["authorization_servers"] == ["http://127.0.0.1:8021"]
    asm = c.get("/.well-known/oauth-authorization-server").json()
    assert asm["client_id_metadata_document_supported"] is True
    assert asm["token_endpoint_auth_methods_supported"] == ["none"]
    assert asm["code_challenge_methods_supported"] == ["S256"]


def test_flujo_completo_y_refresh_con_rotacion(c):
    t = tokens(c)
    assert t["token_type"] == "Bearer" and t["expires_in"] == 3600
    r = c.post("/mcp", json=LIST, headers={**MCP_HEADERS, "Authorization": f"Bearer {t['access_token']}"})
    assert r.status_code == 200 and "get_summary" in r.text

    r = c.post("/token", data={"grant_type": "refresh_token", "refresh_token": t["refresh_token"], "client_id": auth.CLAUDE_WEB})
    assert r.status_code == 200
    t2 = r.json()
    assert t2["refresh_token"] != t["refresh_token"]
    # reutilizar el refresh viejo = robo: invalid_grant y se revoca la familia entera
    r = c.post("/token", data={"grant_type": "refresh_token", "refresh_token": t["refresh_token"], "client_id": auth.CLAUDE_WEB})
    assert r.status_code == 400 and r.json()["error"] == "invalid_grant"
    r = c.post("/mcp", json=LIST, headers={**MCP_HEADERS, "Authorization": f"Bearer {t2['access_token']}"})
    assert r.status_code == 401


def test_pantalla_de_consentimiento(c):
    _, ch = pkce()
    r = c.get("/authorize", params=auth_params(ch))
    assert r.status_code == 200 and "Claude (web, escritorio y móvil)" in r.text and "claude.ai" in r.text
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]


def test_contrasena_mal_y_bloqueo(c):
    _, ch = pkce()
    for _ in range(5):
        assert login(c, ch, pw="mal").status_code == 401
    assert login(c, ch).status_code == 429  # bloqueado aunque ahora sea la buena


def test_cancelar(c):
    _, ch = pkce()
    r = c.post("/authorize", data={**auth_params(ch), "action": "deny"}, follow_redirects=False)
    assert "error=access_denied" in r.headers["location"]


@pytest.mark.parametrize("kw", [
    {"client_id": "https://evil.example/client"},
    {"redirect_uri": "https://evil.example/cb"},
    {"client_id": auth.CLAUDE_CODE, "redirect_uri": "http://localhost:3333/callback"},  # Claude Code apagado por defecto
])
def test_cliente_o_redirect_no_permitidos_no_redirigen(c, kw):
    _, ch = pkce()
    r = c.get("/authorize", params=auth_params(ch, **kw), follow_redirects=False)
    assert r.status_code == 400 and "location" not in r.headers


@pytest.mark.parametrize("kw, err", [
    ({"code_challenge_method": "plain"}, "invalid_request"),
    ({"resource": "https://otro.example/mcp"}, "invalid_target"),
    ({"scope": "admin"}, "invalid_scope"),
])
def test_errores_vuelven_a_claude(c, kw, err):
    _, ch = pkce()
    r = c.get("/authorize", params=auth_params(ch, **kw), follow_redirects=False)
    assert r.status_code == 302 and f"error={err}" in r.headers["location"]


def test_pkce_mal_y_codigo_de_un_solo_uso(c):
    v, ch = pkce()
    code = code_from(login(c, ch))
    assert exchange(c, code, "otro-verifier").json()["error"] == "invalid_grant"
    assert exchange(c, code, v).json()["error"] == "invalid_grant"  # ya consumido


def test_token_de_otro_cliente_o_redirect(c):
    v, ch = pkce()
    code = code_from(login(c, ch))
    assert exchange(c, code, v, redirect_uri="https://claude.ai/otra").json()["error"] == "invalid_grant"
    assert exchange(c, "x", v, client_id="https://evil.example").status_code == 401


def test_claude_code_si_se_activa(c, monkeypatch):
    monkeypatch.setenv("MCP_ALLOW_CLAUDE_CODE", "1")
    v, ch = pkce()
    r = login(c, ch, client_id=auth.CLAUDE_CODE, redirect_uri="http://127.0.0.1:51234/callback")
    assert r.headers["location"].startswith("http://127.0.0.1:51234/callback?code=")


def test_sin_hash_configurado_nadie_entra(c, monkeypatch):
    monkeypatch.delenv("MCP_PASSWORD_HASH")
    _, ch = pkce()
    assert login(c, ch).status_code == 401


def test_health_sin_auth(c):
    assert c.get("/health").json()["db"] == "ok"


# ------------------------- revisión de seguridad -------------------------
@pytest.mark.parametrize("uri", [
    "http://evil.com\\@localhost/callback",
    "http://evil.com@localhost:8000/callback",
    "http://localhost.evil.com:8000/callback",
    "http://localhost:8000/callback?x=1",
    "http://localhost:8000/otra",
    "https://localhost:8000/callback",
])
def test_loopback_estricto(c, monkeypatch, uri):
    monkeypatch.setenv("MCP_ALLOW_CLAUDE_CODE", "1")
    _, ch = pkce()
    r = c.get("/authorize", params=auth_params(ch, client_id=auth.CLAUDE_CODE, redirect_uri=uri), follow_redirects=False)
    assert r.status_code == 400 and "location" not in r.headers


def test_una_ip_no_bloquea_el_acceso_global(c):
    _, ch = pkce()
    for _ in range(5):
        login(c, ch, pw="mal")
    assert not auth.FAILS_ALL.blocked("*")  # 5 de una IP no llenan el cupo global


def test_familia_revocada_muere_entera_aunque_emita_despues(c):
    # carrera: alguien reutiliza el código (revoca) y el ganador emite después
    v, ch = pkce()
    code = code_from(login(c, ch))
    r1 = exchange(c, code, v)
    assert r1.status_code == 200
    assert exchange(c, code, v).json()["error"] == "invalid_grant"  # reutilización → revoca familia
    t = r1.json()
    assert c.post("/mcp", json=LIST, headers={**MCP_HEADERS, "Authorization": f"Bearer {t['access_token']}"}).status_code == 401
    r = c.post("/token", data={"grant_type": "refresh_token", "refresh_token": t["refresh_token"], "client_id": auth.CLAUDE_WEB})
    assert r.json()["error"] == "invalid_grant"


def test_token_de_otro_cliente_no_quema_el_refresh(c, monkeypatch):
    monkeypatch.setenv("MCP_ALLOW_CLAUDE_CODE", "1")
    t = tokens(c)
    r = c.post("/token", data={"grant_type": "refresh_token", "refresh_token": t["refresh_token"], "client_id": auth.CLAUDE_CODE})
    assert r.json()["error"] == "invalid_grant"
    r = c.post("/token", data={"grant_type": "refresh_token", "refresh_token": t["refresh_token"], "client_id": auth.CLAUDE_WEB})
    assert r.status_code == 200


def test_limiter_no_acumula_ips():
    lim = auth.Limiter(3, 60)
    for i in range(1000):
        lim.blocked(f"ip{i}")
    assert lim.hits == {}
