#!/usr/bin/env bash
# COFNIĘCIE: włącza z powrotem crony zatrzymane przez 00-freeze-old.sh w STARYM projekcie.
# Data API włączasz ręcznie w panelu.
source "$(dirname "$0")/lib.sh"
need_cmd psql "brew install postgresql@17"
ask OLD_DB_URL "Adres bazy STAREGO projektu (Session pooler, z hasłem)" secret
[ -s "$W/cron-frozen-names.txt" ] || { echo "Brak listy $W/cron-frozen-names.txt"; exit 1; }
NAMES="{$(paste -sd, "$W/cron-frozen-names.txt")}"
export NAMES
psql "$OLD_DB_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL'
\getenv names NAMES
select cron.alter_job(jobid, active := true) from cron.job where jobname = any (:'names'::text[]);
select count(*) filter (where active) || ' aktywnych z ' || count(*) as crony from cron.job;
SQL
