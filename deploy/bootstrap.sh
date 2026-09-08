#!/usr/bin/env bash
# Puesta en marcha completa en el VPS (Ubuntu, como root). Idempotente:
# re-ejecutarlo no rompe nada.
#
#   sudo REPO_URL=https://github.com/USUARIO/entreno-ferran.git \
#        DOMAIN=entreno.ferranguinart.com \
#        APP_PIN=1234 \
#        bash deploy/bootstrap.sh
#
# Variables:
#   REPO_URL     (opcional) si el código aún no está en /srv/entreno, lo clona
#   DOMAIN       (req.)   dominio público, p.ej. entreno.ferranguinart.com
#   APP_PIN      (req.)   PIN inicial de la app (solo se usa la 1ª vez)
#   DB_PASSWORD  (opcional) se genera si no se pasa; queda en backend/.env
#   PORT         (opcional) puerto interno de uvicorn (def. 8020)
#   RUN_CERTBOT  (opcional) "1" para pedir el certificado ya (requiere DNS ok)
set -euo pipefail

APP_DIR=/srv/entreno
APP_USER=entreno
PORT="${PORT:-8020}"
: "${DOMAIN:?define DOMAIN}"
: "${APP_PIN:?define APP_PIN}"

log() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }

log "Paquetes del sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq postgresql nginx python3-venv python3-pip git curl \
  certbot python3-certbot-nginx ufw

log "Usuario de servicio $APP_USER"
id "$APP_USER" &>/dev/null || useradd --system --create-home --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"

log "Código en $APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only || true
elif [ -n "${REPO_URL:-}" ]; then
  git clone "$REPO_URL" "$APP_DIR"
elif [ -f "$APP_DIR/backend/app.py" ]; then
  echo "  (código ya presente sin git, ok)"
else
  echo "ERROR: no hay código en $APP_DIR y no se pasó REPO_URL" >&2
  exit 1
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

log "PostgreSQL: rol y base de datos"
DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 16)}"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='entreno'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE USER entreno WITH PASSWORD '${DB_PASSWORD}';"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='entreno'" | grep -q 1 \
  || sudo -u postgres createdb -O entreno entreno
DB_URL="postgresql://entreno:${DB_PASSWORD}@localhost:5432/entreno"

log "Entorno Python"
sudo -u "$APP_USER" python3 -m venv "$APP_DIR/backend/.venv"
sudo -u "$APP_USER" "$APP_DIR/backend/.venv/bin/pip" install -q --upgrade pip
sudo -u "$APP_USER" "$APP_DIR/backend/.venv/bin/pip" install -q -r "$APP_DIR/backend/requirements.txt"

log "Fichero .env"
ENV_FILE="$APP_DIR/backend/.env"
if [ -f "$ENV_FILE" ]; then
  echo "  (ya existe, no se toca — edítalo a mano si hace falta)"
else
  install -o "$APP_USER" -g "$APP_USER" -m 600 /dev/null "$ENV_FILE"
  cat > "$ENV_FILE" <<EOF
DATABASE_URL=${DB_URL}
SESSION_SECRET=$(openssl rand -hex 32)
INITIAL_PIN=${APP_PIN}
COOKIE_SECURE=1
EOF
  chown "$APP_USER:$APP_USER" "$ENV_FILE"
  echo "  contraseña de la BD: ${DB_PASSWORD}"
fi

log "Esquema + datos semilla"
sudo -u "$APP_USER" psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$APP_DIR/db/schema.sql"
sudo -u "$APP_USER" psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$APP_DIR/db/seed.sql"

log "Servicio systemd (puerto $PORT)"
sed "s#--port 8020#--port ${PORT}#" "$APP_DIR/deploy/entreno.service" > /etc/systemd/system/entreno.service
systemctl daemon-reload
systemctl enable --now entreno
sleep 1
systemctl --no-pager --lines=0 status entreno || true
curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/" && echo "  app responde en :$PORT ✓"

log "nginx"
NGINX_SITE=/etc/nginx/sites-available/${DOMAIN}
sed -e "s#entreno.ferranguinart.com#${DOMAIN}#g" -e "s#127.0.0.1:8020#127.0.0.1:${PORT}#" \
  "$APP_DIR/deploy/nginx-entreno.conf" > "$NGINX_SITE"
ln -sf "$NGINX_SITE" "/etc/nginx/sites-enabled/${DOMAIN}"
nginx -t && systemctl reload nginx

log "Firewall"
ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow 'Nginx Full' >/dev/null 2>&1 || true
yes | ufw enable >/dev/null 2>&1 || true

if [ "${RUN_CERTBOT:-0}" = "1" ]; then
  log "Certbot (HTTPS)"
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "ferranguinart@gmail.com" --redirect
else
  echo
  echo "HTTPS pendiente. Cuando el DNS A de '$DOMAIN' apunte al VPS:"
  echo "  sudo certbot --nginx -d $DOMAIN"
fi

log "Listo. http://$DOMAIN  (PIN inicial: $APP_PIN)"
