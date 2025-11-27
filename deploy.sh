#!/bin/bash
chmod +x deploy.sh
set -euo pipefail

REMOTE="root@185.235.68.130"
BASE="/var/www/mavinci/frontend"
STAND="${BASE}/.next/standalone"

echo "🚀 Build (standalone)…"
yarn build

[ -d ".next/standalone" ] || { echo "❌ Brak .next/standalone"; exit 1; }

echo "📂 Tworzę strukturę na VPS…"
ssh "$REMOTE" "mkdir -p '${STAND}/.next/static' '${STAND}/public'"

echo "📦 Wysyłam standalone + static + public (we właściwe miejsca)…"
# server + minimalne node_modules
rsync -avz --delete --exclude='.env' \
  .next/standalone/ "${REMOTE}:${STAND}/"

# statyki MUSZĄ być względem server.js → .next/standalone/.next/static
rsync -avz --delete \
  .next/static/ "${REMOTE}:${STAND}/.next/static/"

# public również względem server.js
rsync -avz --delete \
  public/ "${REMOTE}:${STAND}/public/"

echo "🚦 PM2 reload…"
ssh "${REMOTE}" "
  /root/.nvm/versions/node/v20.11.0/bin/pm2 startOrReload ${BASE}/ecosystem.frontend.config.js --update-env && \
  /root/.nvm/versions/node/v20.11.0/bin/pm2 save
"

echo "🩺 Health check…"
ssh "${REMOTE}" "curl -Is http://127.0.0.1:3001/_next/static/css/ | head -n1 || true"

echo "✅ Deploy OK."