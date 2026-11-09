#!/usr/bin/env bash
# DZIEŃ PRZEŁĄCZENIA: włącza crony w NOWYM projekcie (po zatrzymaniu ich w starym — 00-freeze-old.sh).
source "$(dirname "$0")/lib.sh"
need_cmd psql "brew install postgresql@17"
D="$(latest_dump)"
[ -s "$D/cron.prepared.sql" ] || { echo "Brak $D/cron.prepared.sql — uruchom 02-prepare.sh"; exit 1; }
ask_db_url NEW_DB_URL NOWEGO
psql --single-transaction --variable ON_ERROR_STOP=1 --file "$D/cron.prepared.sql" --dbname "$NEW_DB_URL" >/dev/null
psql "$NEW_DB_URL" -X -At -c "select count(*) filter (where active) || ' aktywnych cronów z ' || count(*) from cron.job"
