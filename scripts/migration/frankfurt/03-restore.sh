#!/usr/bin/env bash
# Odtworzenie zrzutu w NOWYM projekcie (pusta baza świeżego projektu). Jedna transakcja — przy błędzie nic nie zostaje.
source "$(dirname "$0")/lib.sh"
need_cmd psql "brew install postgresql@17"
D="$(latest_dump)"
[ -f "$D/schema.prepared.sql" ] || { echo "Najpierw 02-prepare.sh"; exit 1; }
ask_db_url NEW_DB_URL NOWEGO

log "Role, schemat i dane ($(du -sh "$D/data.prepared.sql" | cut -f1) danych)"
time psql --single-transaction --variable ON_ERROR_STOP=1 \
  --command 'SET statement_timeout = 0' \
  --file "$D/roles.prepared.sql" --file "$D/schema.prepared.sql" \
  --command 'SET session_replication_role = replica' \
  --file "$D/data.prepared.sql" --dbname "$NEW_DB_URL"

log "Historia migracji"
psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file "$D/history_schema.prepared.sql" --file "$D/history_data.prepared.sql" --dbname "$NEW_DB_URL"

log "Reguły plików i Realtime, wyzwalacze auth, publikacja"
psql --single-transaction --variable ON_ERROR_STOP=1 --file "$D/platform.prepared.sql" --dbname "$NEW_DB_URL"

log "Statystyki planera"
psql "$NEW_DB_URL" -X -q -c 'SET statement_timeout = 0' -c 'ANALYZE'
echo "Gotowe — dalej 04-vault.sh (crony włącza dopiero 08-cron-new.sh w dniu przełączenia)"
