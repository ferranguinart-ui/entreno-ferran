#!/usr/bin/env bash
# Auto-deploy por sondeo: el VPS mira si origin/main ha avanzado y, si es así,
# se actualiza y reinicia. Lo dispara entreno-deploy.timer cada pocos minutos.
# Repo público → git fetch sin credenciales.
set -euo pipefail

APP_DIR=/srv/entreno
GIT="git -C $APP_DIR -c safe.directory=$APP_DIR"

$GIT fetch -q origin main
LOCAL=$($GIT rev-parse HEAD)
REMOTE=$($GIT rev-parse origin/main)
[ "$LOCAL" = "$REMOTE" ] && exit 0

echo "$(date -Is)  deploy ${LOCAL:0:7} -> ${REMOTE:0:7}"
$GIT reset -q --hard origin/main
"$APP_DIR/deploy/update.sh"
