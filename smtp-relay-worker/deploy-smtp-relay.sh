#!/usr/bin/env bash
set -euo pipefail

# 🔧 KONFIG
REMOTE="root@185.235.68.130"
REMOTE_DIR="/var/www/mavinci/smtp-relay-worker"
APP_NAME="smtp-relay-worker"

# Ścieżki do node/pm2 na VPS (tak jak w frontendzie)
NODE_BIN="/root/.nvm/versions/node/v20.11.0/bin"
PM2="${NODE_BIN}/pm2"

echo "🚀 Deploy SMTP Relay Workera"
echo "📂 Lokalnie:  $(pwd)"
echo "🌐 VPS:      ${REMOTE}:${REMOTE_DIR}"
echo

# 0/3 – lokalny npm install (prod)
echo "📦 0/3 – Lokalny npm install (prod)…"
npm install --omit=dev

# 1/3 – wysyłka plików na VPS
echo
echo "📦 1/3 – Wysyłam pliki na VPS (rsync)…"
rsync -avz \
  --delete \
  --exclude ".git" \
  --exclude ".env" \
  . "${REMOTE}:${REMOTE_DIR}/"

# 2/3 – PM2 start/restart na VPS
echo
echo "🔧 2/3 – PM2 restart na VPS…"
ssh "${REMOTE}" "bash -lc '
  set -e
  export PATH=\"${NODE_BIN}:\$PATH\"

  echo \"🔎 Używany node na VPS: \$(node -v)\"
  echo \"🔎 Używany pm2  na VPS: \$(pm2 -v)\"

  cd \"${REMOTE_DIR}\"

  echo \"🛑 pm2 stop ${APP_NAME} (jeśli działa)…\"
  ${PM2} stop \"${APP_NAME}\" 2>/dev/null || true

  echo \"▶️ pm2 start server.js --name ${APP_NAME}\"
  ${PM2} start server.js --name \"${APP_NAME}\" --update-env

  echo \"💾 pm2 save\"
  ${PM2} save || true
'"

# 3/3 – health check
echo
echo "🩺 3/3 – Health check…"
ssh "${REMOTE}" "curl -sS http://127.0.0.1:3005/health || echo '⚠️ Brak odpowiedzi z /health (sprawdź logi PM2)'"

echo
echo "✅ Deploy SMTP Relay zakończony."