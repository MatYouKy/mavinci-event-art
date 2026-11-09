#!/usr/bin/env bash
# DZIEŃ PRZEŁĄCZENIA, krok 1: zatrzymuje crony w STARYM projekcie (zapamiętuje, które działały).
# Data API wyłączasz ręcznie w panelu (docs/migracja-frankfurt.md). Cofnięcie: 99-unfreeze-old.sh.
source "$(dirname "$0")/lib.sh"
need_cmd psql "brew install postgresql@17"
ask OLD_DB_URL "Adres bazy STAREGO projektu (Session pooler, z hasłem)" secret

log "Zapisuję działające crony do $W/cron-frozen.sql"
psql "$OLD_DB_URL" -X -q -At -v ON_ERROR_STOP=1 -f "$HERE/sql/extract-cron.sql" > "$W/cron-frozen.sql"
psql "$OLD_DB_URL" -X -q -At -v ON_ERROR_STOP=1 -c "select jobname from cron.job where active order by jobname" > "$W/cron-frozen-names.txt"
echo "Zadań: $(wc -l < "$W/cron-frozen-names.txt" | xargs)"

log "Wyłączam crony w starym projekcie"
psql "$OLD_DB_URL" -X -q -v ON_ERROR_STOP=1 -c "select cron.alter_job(jobid, active := false) from cron.job where active;" >/dev/null
psql "$OLD_DB_URL" -X -At -c "select count(*) filter (where active) || ' aktywnych z ' || count(*) from cron.job"
echo "Gotowe. Teraz wyłącz Data API starego projektu i uruchom 01-dump.sh."
