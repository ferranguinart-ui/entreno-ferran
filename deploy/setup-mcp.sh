#!/usr/bin/env bash
# Puesta en marcha del servidor MCP en el VPS (como root, una sola vez; idempotente).
# Requiere que la app ya esté instalada en /srv/entreno (bootstrap.sh) y el DNS de
# mcp.ferranguinart.com apuntando al VPS.
#
#   sudo bash /srv/entreno/deploy/setup-mcp.sh
#
# Pide la contraseña de la pantalla de autorización (no se guarda: solo su hash).
set -euo pipefail

APP_DIR=/srv/entreno
APP_USER=entreno
DOMAIN="${DOMAIN:-mcp.ferranguinart.com}"
MCP_DIR="$APP_DIR/mcp_server"
ENV_FILE="$MCP_DIR/.env"
log() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }

log "Python ≥ 3.10"
PY=""
for c in python3.13 python3.12 python3.11 python3.10 python3; do
  if command -v "$c" >/dev/null && "$c" -c 'import sys; sys.exit(sys.version_info < (3, 10))'; then PY="$(command -v "$c")"; break; fi
done
[ -n "$PY" ] || { echo "Falta Python ≥ 3.10 (apt install python3.12 python3.12-venv)" >&2; exit 1; }
"$PY" --version
apt-get install -y -qq "$(basename "$PY")-venv" >/dev/null 2>&1 || apt-get install -y -qq python3-venv >/dev/null

log "Entorno virtual del MCP"
[ -x "$MCP_DIR/.venv/bin/python" ] || sudo -u "$APP_USER" "$PY" -m venv "$MCP_DIR/.venv"
sudo -u "$APP_USER" "$MCP_DIR/.venv/bin/pip" install -q -U pip
sudo -u "$APP_USER" "$MCP_DIR/.venv/bin/pip" install -q -r "$MCP_DIR/requirements.txt"

log "Esquema (audit_log, mcp_tokens, sessions.note)"
set -a; . "$APP_DIR/backend/.env"; set +a
sudo -u "$APP_USER" psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$APP_DIR/db/schema.sql"

log "Configuración $ENV_FILE"
if ! grep -q '^MCP_PASSWORD_HASH=' "$ENV_FILE" 2>/dev/null; then
  echo "Elige la contraseña de la pantalla de autorización (mínimo 12 caracteres):"
  HASH="$(cd "$MCP_DIR" && sudo -u "$APP_USER" .venv/bin/python auth.py hash-password)"
  umask 077
  cat > "$ENV_FILE" <<ENV
MCP_PUBLIC_URL=https://$DOMAIN
MCP_ALLOWED_HOSTS=$DOMAIN
MCP_PASSWORD_HASH=$HASH
ENV
  chown "$APP_USER:$APP_USER" "$ENV_FILE"; chmod 600 "$ENV_FILE"
else
  echo "  (ya existe; para cambiar la contraseña borra la línea MCP_PASSWORD_HASH y vuelve a ejecutar)"
fi

log "Servicio systemd"
cp "$APP_DIR/deploy/entreno-mcp.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable -q entreno-mcp
systemctl restart entreno-mcp
sleep 2
curl -fsS http://127.0.0.1:8021/health && echo

log "nginx + HTTPS"
cp "$APP_DIR/deploy/nginx-mcp.conf" "/etc/nginx/sites-available/$DOMAIN"
ln -sf "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-enabled/$DOMAIN"
nginx -t && systemctl reload nginx
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect --register-unsafely-without-email || \
  certbot --nginx -d "$DOMAIN" --redirect
curl -fsS "https://$DOMAIN/health" && echo
echo "✓ MCP listo en https://$DOMAIN/mcp"
