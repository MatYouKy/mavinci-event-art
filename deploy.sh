#!/bin/bash
set -euo pipefail

REMOTE="root@83.150.236.238"
REMOTE_DIR="/var/www/mavinci/frontend"

echo "🚀 Buduję Next.js (standalone)…"
yarn build

# sanity check
if [ ! -d ".next/standalone" ]; then
  echo "❌ Brak .next/standalone — dodaj output: 'standalone' w next.config.js i zbuduj ponownie."
  exit 1
fi

echo "📂 Tworzę strukturę na VPS (jeśli brak)…"
ssh "$REMOTE" "mkdir -p '${REMOTE_DIR}/.next/standalone' '${REMOTE_DIR}/.next/static' '${REMOTE_DIR}/public'"

echo "📦 Wysyłka artefaktów…"
# 1) standalone serwer (bez .env)
rsync -avz --delete --exclude='.env' \
  .next/standalone/ "${REMOTE}:${REMOTE_DIR}/.next/standalone/"

# 2) statyki Nexta
rsync -avz --delete \
  .next/static/ "${REMOTE}:${REMOTE_DIR}/.next/static/"

# 3) public/
rsync -avz --delete \
  public/ "${REMOTE}:${REMOTE_DIR}/public/"

# 4) (opcjonalnie) package.json / yarn.lock — tylko jeśli istnieją
if [ -f package.json ]; then
  rsync -avz package.json "${REMOTE}:${REMOTE_DIR}/"
fi
if [ -f yarn.lock ]; then
  rsync -avz yarn.lock "${REMOTE}:${REMOTE_DIR}/"
fi

echo "🚦 PM2 reload frontu…"
ssh "${REMOTE}" "
  cd '${REMOTE_DIR}' && \
  /root/.nvm/versions/node/v20.11.0/bin/pm2 startOrReload ecosystem.frontend.config.js --update-env && \
  /root/.nvm/versions/node/v20.11.0/bin/pm2 save
"

echo "✅ Deploy frontu OK."