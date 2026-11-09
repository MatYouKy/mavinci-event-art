#!/usr/bin/env bash
# Zrzut STAREGO projektu: role, schemat, dane, historia migracji, reguły plików, wyzwalacze auth,
# publikacja Realtime, crony i liczby wierszy. Wynik: $WORK_DIR/dump-<data>/ (link: latest).
source "$(dirname "$0")/lib.sh"
need_cmd supabase "brew install supabase/tap/supabase"
need_cmd docker "Docker Desktop (Supabase CLI uruchamia pg_dump w kontenerze)"
need_cmd psql "brew install postgresql@17"
ask_db_url OLD_DB_URL STAREGO

D="$W/dump-$(date +%Y%m%d-%H%M)"
mkdir -p "$D"
ln -sfn "$D" "$W/latest"
T="$(dump_target "$OLD_DB_URL")"

log "Role"
supabase db dump "$T" -f "$D/roles.sql" --role-only
log "Schemat"
supabase db dump "$T" -f "$D/schema.sql"
log "Dane (bez plików Storage, sekretów Vault, cronów i kolejek pg_net — przenoszą je osobne kroki)"
supabase db dump "$T" -f "$D/data.sql" --use-copy --data-only \
  -x storage.buckets -x storage.objects -x storage.prefixes \
  -x storage.s3_multipart_uploads -x storage.s3_multipart_uploads_parts \
  -x storage.buckets_analytics -x storage.buckets_vectors -x storage.vector_indexes \
  -x vault.secrets -x cron.job -x cron.job_run_details \
  -x net.http_request_queue -x net._http_response
log "Historia migracji"
supabase db dump "$T" -f "$D/history_schema.sql" --schema supabase_migrations
supabase db dump "$T" -f "$D/history_data.sql" --use-copy --data-only --schema supabase_migrations

log "Reguły plików i Realtime, wyzwalacze auth, publikacja"
psql "$OLD_DB_URL" -X -q -At -v ON_ERROR_STOP=1 -f "$HERE/sql/extract-platform.sql" > "$D/platform.sql"
log "Crony"
if [ -s "$W/cron-frozen.sql" ]; then
  cp "$W/cron-frozen.sql" "$D/cron.sql"   # dzień przełączenia: lista sprzed zatrzymania
else
  psql "$OLD_DB_URL" -X -q -At -v ON_ERROR_STOP=1 -f "$HERE/sql/extract-cron.sql" > "$D/cron.sql"
fi
log "Liczby wierszy (do porównania po odtworzeniu)"
psql "$OLD_DB_URL" -X -q -At -F $'\t' -v ON_ERROR_STOP=1 -f "$HERE/sql/counts.sql" > "$D/counts-old.tsv"

log "Gotowe: $D"
ls -lh "$D"
