#!/usr/bin/env bash
# DZIEŃ PRZEŁĄCZENIA: nowy projekt w konfiguracji — na tym komputerze (.env do kompilacji CRM, mobile/.env,
# aplikacja na Maca, statyczne HTML) i na serwerze (pliki .env* i ecosystem* w /var/www/mavinci: CRM, przekaźnik SMTP).
# Adres starego projektu i jego klucze anon / service_role (rozpoznawane po zawartości) zamienia na nowe.
# Kopia każdego zmienionego pliku: <plik>.przed-frankfurtem. Wartości kluczy nie są wypisywane.
#   ./12-switch-config.sh            — zmienia
#   ./12-switch-config.sh --dry-run  — tylko pokazuje, co by zmienił
#   ./12-switch-config.sh --cofnij   — przywraca pliki z kopii (plan B), potem yarn deploy
source "$(dirname "$0")/lib.sh"
need_cmd perl "perl (jest w macOS)"
need_cmd ssh "ssh (jest w macOS)"
REMOTE="${MAVINCI_DEPLOY_REMOTE:-root@185.235.68.130}"
SERVER_DIR="/var/www/mavinci"
PM2_BIN="/root/.nvm/versions/node/v20.11.0/bin"
MODE=apply
case "${1:-}" in
  "") ;;
  --dry-run) MODE=dry ;;
  --cofnij) MODE=restore ;;
  *) echo "Użycie: ./12-switch-config.sh [--dry-run|--cofnij]"; exit 1 ;;
esac

if [ "$MODE" != restore ]; then
  if [ -z "${NEW_REF:-}" ] && [ -f "$W/latest/new-ref.txt" ]; then
    NEW_REF="$(tr -d '[:space:]' < "$W/latest/new-ref.txt")"; export NEW_REF
    echo "Nowy projekt: $NEW_REF"
  fi
  ask NEW_REF "Identyfikator NOWEGO projektu"
  ask NEW_ANON_KEY "Klucz anon NOWEGO projektu (Legacy API Keys → anon)" secret
  ask NEW_SERVICE_ROLE_KEY "Klucz service_role NOWEGO projektu (Legacy API Keys → service_role)" secret
  printf '%s\n%s\n' "$NEW_ANON_KEY" "$NEW_SERVICE_ROLE_KEY" | OLD_REF="$OLD_REF" NEW_REF="$NEW_REF" perl "$HERE/switch-config.pl" check
fi
export OLD_REF NEW_REF="${NEW_REF:-}"

log "Ten komputer (repo)"
cd "$REPO"
FILES=()
for f in .env .env.local .env.production .env.production.local mobile/.env mobile/.env.local \
  desktop/mac/Resources/Configuration.json public/invitation-empoliye.html \
  src/components/crm/events/email/email-template.html; do
  [ -f "$f" ] && FILES+=("$f")
done
printf '%s\n%s\n' "${NEW_ANON_KEY:-}" "${NEW_SERVICE_ROLE_KEY:-}" | perl "$HERE/switch-config.pl" "$MODE" "${FILES[@]}"

log "Serwer $REMOTE ($SERVER_DIR)"
ssh -o ConnectTimeout=10 -o ConnectionAttempts=1 "$REMOTE" 'true' || { echo "Brak połączenia SSH z serwerem — zmiany lokalne zostały, uruchom skrypt ponownie."; exit 1; }
RT="$(ssh "$REMOTE" 'umask 077; mktemp /root/.switch-config.XXXXXX')"
ssh "$REMOTE" "cat > '$RT'" < "$HERE/switch-config.pl"
printf '%s\n%s\n' "${NEW_ANON_KEY:-}" "${NEW_SERVICE_ROLE_KEY:-}" | \
  ssh "$REMOTE" "OLD_REF='$OLD_REF' NEW_REF='$NEW_REF' perl '$RT' '$MODE' --find '$SERVER_DIR'"
echo "Procesy PM2 (po yarn deploy CRM i przekaźnik SMTP startują z nową konfiguracją):"
ssh "$REMOTE" "PATH='$PM2_BIN':\$PATH; pm2 jlist 2>/dev/null | OLD_REF='$OLD_REF' perl '$RT' pm2; rm -f '$RT'"
echo "Inne miejsca na serwerze ze starym projektem (tylko lista, bez zmian):"
ssh "$REMOTE" "n=\$(crontab -l 2>/dev/null | grep -c '$OLD_REF' || true); echo \"  crontab: \$n\"; grep -rIl '$OLD_REF' /etc/nginx /etc/cron.d /etc/systemd/system 2>/dev/null | sed 's/^/  /' || true"

log "Gotowe"
if [ "$MODE" = apply ]; then
  echo "Dalej: yarn deploy w katalogu repo (CRM kompiluje się z nowym adresem i kluczem, restart CRM i przekaźnika SMTP)."
elif [ "$MODE" = restore ]; then
  echo "Przywrócono pliki sprzed przełączenia. Dalej: yarn deploy."
fi
