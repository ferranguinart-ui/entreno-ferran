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

echo "▶ datos semilla (idempotente: recoge cambios del plan)"
sudo -u "$APP_USER" psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$APP_DIR/db/seed.sql"

echo "▶ reinicio del servicio"
systemctl restart entreno
sleep 1
PORT="$(grep -oE -- '--port [0-9]+' /etc/systemd/system/entreno.service | awk '{print $2}')"
curl -fsS -o /dev/null "http://127.0.0.1:${PORT:-8020}/" && echo "✓ app OK en :${PORT:-8020}"

# Nota: db/schema.sql NO se aplica en cada deploy. Si cambias el esquema,
# ejecútalo a mano:  sudo -u entreno psql "$DATABASE_URL" -f db/schema.sql
