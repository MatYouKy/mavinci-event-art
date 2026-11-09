#!/usr/bin/env bash
# Porównanie NOWEGO projektu ze zrzutem: liczby wierszy w tabelach, reguły plików, publikacja, Vault, crony.
source "$(dirname "$0")/lib.sh"
need_cmd psql "brew install postgresql@17"
D="$(latest_dump)"
ask_db_url NEW_DB_URL NOWEGO

psql "$NEW_DB_URL" -X -q -At -F $'\t' -v ON_ERROR_STOP=1 -f "$HERE/sql/counts.sql" > "$D/counts-new.tsv"
log "Tabele z inną liczbą wierszy (pusto = wszystko zgodne)"
if diff <(sort "$D/counts-old.tsv") <(sort "$D/counts-new.tsv"); then
  echo "Wszystkie tabele zgodne ($(wc -l < "$D/counts-new.tsv" | xargs))."
fi

log "Elementy platformy"
psql "$NEW_DB_URL" -X -q <<'SQL'
select 'reguły storage.objects' as co, count(*)::text as ile from pg_policies where schemaname = 'storage'
union all select 'tabele w Realtime', count(*)::text from pg_publication_tables where pubname = 'supabase_realtime'
union all select 'wyzwalacze auth.users', count(*)::text from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal
union all select 'sekrety Vault', string_agg(name, ', ' order by name) from vault.secrets
union all select 'crony (aktywne / wszystkie)', count(*) filter (where active) || ' / ' || count(*) from cron.job
union all select 'konta', count(*)::text from auth.users;
SQL
echo "Stary projekt (09.11.2026): 102 reguły storage, 64 tabele Realtime, 1 wyzwalacz auth.users, 4 sekrety Vault, 21 cronów, 19 kont."
