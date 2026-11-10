#!/usr/bin/env bash
# Restart procesów Mavinci na serwerze z nowym projektem — bez kompilacji. PM2 pamięta zmienne z poprzednich
# uruchomień, więc zmienne procesu, które mają jeszcze stary adres lub klucz, dostają nowe wartości (wyliczone na
# serwerze, bez wypisywania). Dotyczy tylko: frontend-mavinci, smtp-relay-worker, server-mavinci-PORT8081.
source "$(dirname "$0")/lib.sh"
need_cmd ssh "ssh (jest w macOS)"
REMOTE="${MAVINCI_DEPLOY_REMOTE:-root@185.235.68.130}"
BASE="/var/www/mavinci/frontend"
RELAY="/var/www/mavinci/smtp-relay-worker"
NODE_BIN="/root/.nvm/versions/node/v20.11.0/bin"

if [ -z "${NEW_REF:-}" ] && [ -f "$W/latest/new-ref.txt" ]; then
  NEW_REF="$(tr -d '[:space:]' < "$W/latest/new-ref.txt")"; export NEW_REF
  echo "Nowy projekt: $NEW_REF"
fi
ask NEW_REF "Identyfikator NOWEGO projektu"
ask NEW_ANON_KEY "Klucz anon NOWEGO projektu (Legacy API Keys → anon)" secret
ask NEW_SERVICE_ROLE_KEY "Klucz service_role NOWEGO projektu (Legacy API Keys → service_role)" secret
printf '%s\n%s\n' "$NEW_ANON_KEY" "$NEW_SERVICE_ROLE_KEY" | OLD_REF="$OLD_REF" NEW_REF="$NEW_REF" perl "$HERE/switch-config.pl" check

ssh -o ConnectTimeout=10 -o ConnectionAttempts=1 "$REMOTE" 'true' || { echo "Brak połączenia SSH z serwerem."; exit 1; }
RD="$(ssh "$REMOTE" 'umask 077; mktemp -d /root/.mavinci-restart.XXXXXX')"
trap 'ssh "$REMOTE" "rm -rf '"'"'$RD'"'"'" >/dev/null 2>&1 || true' EXIT
ssh "$REMOTE" "cat > '$RD/s.pl'" < "$HERE/switch-config.pl"
ENVS="OLD_REF='$OLD_REF' NEW_REF='$NEW_REF'"

log "Zmienne procesów ze starym projektem"
ssh "$REMOTE" "export PATH='$NODE_BIN':\$PATH; umask 077; pm2 jlist > '$RD/jlist.json' 2>/dev/null; $ENVS perl '$RD/s.pl' pm2 < '$RD/jlist.json'"
for p in frontend-mavinci smtp-relay-worker server-mavinci-PORT8081; do
  printf '%s\n%s\n' "$NEW_ANON_KEY" "$NEW_SERVICE_ROLE_KEY" | \
    ssh "$REMOTE" "umask 077; $ENVS perl '$RD/s.pl' pm2env '$RD/jlist.json' '$p' > '$RD/$p.env'"
done

log "CRM (frontend-mavinci)"
ssh "$REMOTE" "
  set -e
  export PATH='${NODE_BIN}':\$PATH
  export PLAYWRIGHT_BROWSERS_PATH='/root/.cache/ms-playwright'
  set -a
  [ -f '${BASE}/.env' ] && . '${BASE}/.env'
  [ -f '${BASE}/.env.imap-attachments' ] && . '${BASE}/.env.imap-attachments'
  . '$RD/frontend-mavinci.env'
  set +a
  pm2 startOrReload '${BASE}/ecosystem.frontend.config.js' --update-env >/dev/null
  pm2 restart frontend-mavinci --update-env >/dev/null
  pm2 save >/dev/null
  sleep 4
  curl -Is http://127.0.0.1:3001/ | head -n1 || true
"

log "Przekaźnik SMTP (smtp-relay-worker)"
ssh "$REMOTE" "
  set -e
  export PATH='${NODE_BIN}':\$PATH
  cd '${RELAY}'
  set -a
  . ./.env
  . '$RD/smtp-relay-worker.env'
  set +a
  pm2 restart smtp-relay-worker --update-env >/dev/null
  pm2 save >/dev/null
  echo 'zrestartowany'
"

log "server-mavinci-PORT8081"
ssh "$REMOTE" "
  set -e
  export PATH='${NODE_BIN}':\$PATH
  if [ -s '$RD/server-mavinci-PORT8081.env' ] && pm2 describe server-mavinci-PORT8081 >/dev/null 2>&1; then
    set -a; . '$RD/server-mavinci-PORT8081.env'; set +a
    pm2 restart server-mavinci-PORT8081 --update-env >/dev/null
    pm2 save >/dev/null
    echo 'zrestartowany z nowymi wartościami'
  else
    echo 'bez zmian'
  fi
"

log "Kontrola po restarcie"
ssh "$REMOTE" "export PATH='$NODE_BIN':\$PATH; pm2 jlist 2>/dev/null | $ENVS perl '$RD/s.pl' pm2"
log "Gotowe — odśwież CRM w przeglądarce (Cmd+Shift+R)"
