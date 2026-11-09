#!/usr/bin/env bash
# Kopiowanie plików Storage ze STAREGO do NOWEGO projektu (kontenery z ustawieniami + pliki).
# Można uruchamiać wielokrotnie: pliki już skopiowane (ta sama ścieżka i rozmiar) są pomijane.
#   ./05-storage.sh                      — kopiuje brakujące i zmienione
#   ./05-storage.sh --dry-run            — tylko liczy, co by skopiował
#   ./05-storage.sh --prune              — dodatkowo usuwa w nowym projekcie pliki usunięte w starym
#   ./05-storage.sh --bucket=site-images — jeden kontener
source "$(dirname "$0")/lib.sh"
need_cmd node "Node.js 18+"
ask OLD_SERVICE_ROLE_KEY "Klucz service_role STAREGO projektu" secret
ask NEW_REF "Identyfikator NOWEGO projektu"
ask NEW_SERVICE_ROLE_KEY "Klucz service_role / secret NOWEGO projektu" secret
cd "$REPO"
OLD_URL="https://${OLD_REF}.supabase.co" NEW_URL="https://${NEW_REF}.supabase.co" LOG_DIR="$W" \
  node "$HERE/copy-storage.mjs" "$@"
