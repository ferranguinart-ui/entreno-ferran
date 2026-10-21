#!/usr/bin/env bash
# Actualización tras un deploy. Lo llama el workflow de GitHub Actions por SSH,
# o se puede correr a mano en el VPS:  sudo /srv/entreno/deploy/update.sh
#
# Asume que el código nuevo YA está en /srv/entreno (rsync del workflow o git pull).
set -euo pipefail

APP_DIR=/srv/entreno
APP_USER=entreno
ENV_FILE="$APP_DIR/backend/.env"

cd "$APP_DIR"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
[ -f "$ENV_FILE" ] || { echo "falta $ENV_FILE — corre bootstrap.sh primero" >&2; exit 1; }

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

echo "▶ dependencias"
sudo -u "$APP_USER" "$APP_DIR/backend/.venv/bin/pip" install -q -r "$APP_DIR/backend/requirements.txt"

echo "▶ esquema (idempotente: create if not exists + alter ... add column if not exists)"
sudo -u "$APP_USER" psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$APP_DIR/db/schema.sql"

echo "▶ datos semilla (idempotente: recoge cambios del plan)"
sudo -u "$APP_USER" psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$APP_DIR/db/seed.sql"

echo "▶ reinicio del servicio"
systemctl restart entreno
sleep 1
PORT="$(grep -oE -- '--port [0-9]+' /etc/systemd/system/entreno.service | awk '{print $2}')"
curl -fsS -o /dev/null "http://127.0.0.1:${PORT:-8020}/" && echo "✓ app OK en :${PORT:-8020}"

# Servidor MCP (si ya se instaló con setup-mcp.sh). Va después de la app y no
# la tumba: si el MCP falla, el deploy de la app ya está hecho.
if [ -f /etc/systemd/system/entreno-mcp.service ] && [ -x "$APP_DIR/mcp_server/.venv/bin/pip" ]; then
  echo "▶ MCP: dependencias y reinicio"
  if sudo -u "$APP_USER" "$APP_DIR/mcp_server/.venv/bin/pip" install -q -r "$APP_DIR/mcp_server/requirements.txt" \
     && cp "$APP_DIR/deploy/entreno-mcp.service" /etc/systemd/system/ && systemctl daemon-reload \
     && systemctl restart entreno-mcp && sleep 2 && curl -fsS -o /dev/null http://127.0.0.1:8021/health; then
    echo "✓ MCP OK en :8021"
  else
    echo "✗ MCP no arrancó: journalctl -u entreno-mcp -n 50" >&2
  fi
fi

# Nota: db/schema.sql se aplica en cada deploy ANTES del seed, así que debe
# seguir siendo idempotente. Columnas nuevas en tablas existentes: añádelas
# también con "alter table ... add column if not exists" (create table if not
# exists no las crea en una BD ya existente).
