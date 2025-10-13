#!/bin/bash
set -euo pipefail

# 🖥️ Ustawienia
REMOTE="root@83.150.236.238"
REMOTE_DIR="/var/www/mavinci/frontend"
BUILD_DIR=".next"  # jeśli używasz next export → zmień na "out"

echo "🚀 Budowanie frontendu Next.js..."
yarn build

echo "📦 Wysyłanie plików na VPS (${REMOTE})..."
# Wysyłamy tylko potrzebne katalogi (bez node_modules)
rsync -avz --delete \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.env*' \
  ${BUILD_DIR}/ "${REMOTE}:${REMOTE_DIR}/${BUILD_DIR}/"

# Dodatkowo statyczne zasoby (public)
rsync -avz --delete public/ "${REMOTE}:${REMOTE_DIR}/public/"

echo "🔧 Kopiowanie pliku package.json (jeśli potrzebny do startu Next.js)"
rsync -avz package.json yarn.lock "${REMOTE}:${REMOTE_DIR}/"

echo "📂 Uaktualnianie zależności i restart frontu..."
ssh "${REMOTE}" "
  cd ${REMOTE_DIR} && \
  yarn install --production && \
  /root/.nvm/versions/node/v20.11.0/bin/pm2 startOrReload ecosystem.config.js --update-env && \
  /root/.nvm/versions/node/v20.11.0/bin/pm2 save
"

echo "✅ Deploy zakończony pomyślnie."