#!/usr/bin/env bash
# Auto-deploy por sondeo: el VPS mira si origin/main ha avanzado y, si es así,
# se actualiza y reinicia. Lo dispara entreno-deploy.timer cada pocos minutos.
# Repo público → git fetch sin credenciales.
set -euo pipefail

APP_DIR=/srv/entreno
cd "$APP_DIR"
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true

git fetch -q origin main
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
[ "$LOCAL" = "$REMOTE" ] && exit 0

echo "$(date -Is)  deploy ${LOCAL:0:7} -> ${REMOTE:0:7}"
git reset -q --hard origin/main
"$APP_DIR/deploy/update.sh"
