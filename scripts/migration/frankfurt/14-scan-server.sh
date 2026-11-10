#!/usr/bin/env bash
# Szuka starego projektu we WSZYSTKICH plikach tekstowych usług Mavinci na serwerze (kod i konfiguracja poza repo,
# np. /var/www/mavinci/frontend/imap-sync-worker) i zamienia adres oraz klucze na nowe. Kopie: <plik>.przed-frankfurtem.
#   ./14-scan-server.sh --dry-run   — tylko lista plików (bez kluczy)
#   ./14-scan-server.sh             — zamienia, restartuje mavinci-imap-sync (zawsze) i server-mavinci-PORT8081 (gdy jego pliki się zmieniły)
source "$(dirname "$0")/lib.sh"
need_cmd ssh "ssh (jest w macOS)"
REMOTE="${MAVINCI_DEPLOY_REMOTE:-root@185.235.68.130}"
SERVER_DIR="/var/www/mavinci"
NODE_BIN="/root/.nvm/versions/node/v20.11.0/bin"
MODE=apply
[ "${1:-}" = "--dry-run" ] && MODE=dry
if [ "$MODE" = apply ]; then
  if [ -z "${NEW_REF:-}" ] && [ -f "$W/latest/new-ref.txt" ]; then
    NEW_REF="$(tr -d '[:space:]' < "$W/latest/new-ref.txt")"; export NEW_REF; echo "Nowy projekt: $NEW_REF"
  fi
  ask NEW_REF "Identyfikator NOWEGO projektu"
  ask NEW_ANON_KEY "Klucz anon NOWEGO projektu (Legacy API Keys → anon)" secret
  ask NEW_SERVICE_ROLE_KEY "Klucz service_role NOWEGO projektu (Legacy API Keys → service_role)" secret
  printf '%s\n%s\n' "$NEW_ANON_KEY" "$NEW_SERVICE_ROLE_KEY" | OLD_REF="$OLD_REF" NEW_REF="$NEW_REF" perl "$HERE/switch-config.pl" check
fi
NEW_REF="${NEW_REF:-$(tr -d '[:space:]' < "$W/latest/new-ref.txt" 2>/dev/null || true)}"
ssh -o ConnectTimeout=10 -o ConnectionAttempts=1 "$REMOTE" 'true' || { echo "Brak połączenia SSH z serwerem."; exit 1; }
RD="$(ssh "$REMOTE" 'umask 077; mktemp -d /root/.mavinci-scan.XXXXXX')"
trap 'ssh "$REMOTE" "rm -rf '"'"'$RD'"'"'" >/dev/null 2>&1 || true' EXIT
ssh "$REMOTE" "cat > '$RD/s.pl'" < "$HERE/switch-config.pl"

log "Pliki ze starym projektem w $SERVER_DIR"
printf '%s\n%s\n' "${NEW_ANON_KEY:-}" "${NEW_SERVICE_ROLE_KEY:-}" | \
  ssh "$REMOTE" "OLD_REF='$OLD_REF' NEW_REF='$NEW_REF' perl '$RD/s.pl' '$MODE' --find-all '$SERVER_DIR' | tee '$RD/report.txt'"

if [ "$MODE" = apply ]; then
  log "Restart usług, których pliki się zmieniły"
  ssh "$REMOTE" "
    export PATH='$NODE_BIN':\$PATH
    restart() { pm2 describe \"\$1\" >/dev/null 2>&1 && pm2 restart \"\$1\" --update-env >/dev/null && echo \"  zrestartowano: \$1\"; }
    # Synchronizacja poczty czyta konfigurację tylko przy starcie — restart zawsze.
    restart mavinci-imap-sync
    grep -q '/var/www/mavinci/server/.*\\(adres\\|klucz\\)' '$RD/report.txt' && restart server-mavinci-PORT8081
    pm2 save >/dev/null
    true
  "
fi
log "Gotowe"
