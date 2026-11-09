#!/usr/bin/env bash
# Lokalny CRM (yarn dev) podłączony do NOWEGO projektu: tworzy .env.local w katalogu repo (git go ignoruje,
# ma pierwszeństwo przed .env). Serwer produkcyjny tego pliku nie widzi.
#   ./11-local-env.sh           — tworzy .env.local (pyta o identyfikator i klucze)
#   ./11-local-env.sh --remove  — usuwa .env.local (lokalny CRM wraca do bazy z .env)
source "$(dirname "$0")/lib.sh"
TARGET="${REPO:?}/.env.local"

if [ "${1:-}" = "--remove" ]; then
  rm -f -- "$TARGET"
  echo "Usunięto .env.local — lokalny CRM łączy się z bazą z .env. Zrestartuj yarn dev."
  exit 0
fi

ask NEW_REF "Identyfikator NOWEGO projektu"
ask NEW_ANON_KEY "Klucz anon NOWEGO projektu" secret
ask NEW_SERVICE_ROLE_KEY "Klucz service_role NOWEGO projektu" secret
check_key NEW_ANON_KEY
check_key NEW_SERVICE_ROLE_KEY

umask 077
printf 'NEXT_PUBLIC_SUPABASE_URL=https://%s.supabase.co\nNEXT_PUBLIC_SUPABASE_ANON_KEY=%s\nSUPABASE_SERVICE_ROLE_KEY=%s\n' \
  "$NEW_REF" "$NEW_ANON_KEY" "$NEW_SERVICE_ROLE_KEY" > "$TARGET"
echo "Utworzono $TARGET (adres: https://${NEW_REF}.supabase.co)."
echo "Zatrzymaj yarn dev (Ctrl+C), jeśli działa, i uruchom go ponownie w katalogu repo."
