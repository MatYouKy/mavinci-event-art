#!/usr/bin/env bash
# Restart CRM i przekaźnika SMTP na serwerze z aktualnymi plikami konfiguracyjnymi — bez kompilacji
# (gdy 12-switch-config.sh zmienił tylko pliki na serwerze). To samo co końcówka deploy.sh i deploy-smtp-relay.sh.
source "$(dirname "$0")/lib.sh"
REMOTE="${MAVINCI_DEPLOY_REMOTE:-root@185.235.68.130}"
BASE="/var/www/mavinci/frontend"
RELAY="/var/www/mavinci/smtp-relay-worker"
NODE_BIN="/root/.nvm/versions/node/v20.11.0/bin"
ssh -o ConnectTimeout=10 -o ConnectionAttempts=1 "$REMOTE" 'true' || { echo "Brak połączenia SSH z serwerem."; exit 1; }

log "CRM (frontend-mavinci)"
ssh "$REMOTE" "
  set -e
  export PATH='${NODE_BIN}':\$PATH
  export PLAYWRIGHT_BROWSERS_PATH='/root/.cache/ms-playwright'
  set -a
  [ -f '${BASE}/.env' ] && . '${BASE}/.env'
  [ -f '${BASE}/.env.imap-attachments' ] && . '${BASE}/.env.imap-attachments'
  set +a
  pm2 startOrReload '${BASE}/ecosystem.frontend.config.js' --update-env >/dev/null
  pm2 restart frontend-mavinci --update-env >/dev/null
  pm2 save >/dev/null
  sleep 3
  curl -Is http://127.0.0.1:3001/ | head -n1 || true
"

log "Przekaźnik SMTP (smtp-relay-worker)"
ssh "$REMOTE" "
  set -e
  export PATH='${NODE_BIN}':\$PATH
  cd '${RELAY}'
  set -a
  . ./.env
  set +a
  pm2 restart smtp-relay-worker --update-env >/dev/null
  pm2 save >/dev/null
  sleep 2
  curl -s -o /dev/null -w 'health: %{http_code}\n' \"http://127.0.0.1:\${PORT:-3005}/health\" || true
"
log "Gotowe"
