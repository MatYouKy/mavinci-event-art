#!/usr/bin/env bash
# Zrzut STAREGO projektu: role, schemat, dane, historia migracji, reguły plików, wyzwalacze auth,
# publikacja Realtime, crony i liczby wierszy. Wynik: $WORK_DIR/dump-<data>/ (link: latest).
#   ./01-dump.sh            — nowy zrzut
#   ./01-dump.sh --dokoncz  — dokończ ostatni zrzut, który przerwał się w połowie: kroki z gotowym plikiem są pomijane
source "$(dirname "$0")/lib.sh"
RESUME=""
[ "${1:-}" = "--dokoncz" ] && RESUME=1
need_cmd supabase "brew install supabase/tap/supabase"
need_cmd docker "Docker Desktop (Supabase CLI uruchamia pg_dump w kontenerze)"
need_cmd psql "brew install postgresql@17"
ask_db_url OLD_DB_URL STAREGO

if [ -n "$RESUME" ]; then
  [ -d "$W/latest" ] || { echo "Brak wcześniejszego zrzutu — uruchom ./01-dump.sh bez --dokoncz."; exit 1; }
  D="$(cd "$W/latest" && pwd -P)"
  echo "Dokańczam zrzut: $D"
else
  D="$W/dump-$(date +%Y%m%d-%H%M)"
  mkdir -p "$D"
  ln -sfn "$D" "$W/latest"
fi
T="$(dump_target "$OLD_DB_URL")"

# Przy --dokoncz pomija krok, którego plik już jest (niepusty).
have() { [ -n "$RESUME" ] && [ -s "$1" ] && { echo "Jest już $(basename "$1") — pomijam."; return 0; }; return 1; }
# Wynik psql najpierw do pliku tymczasowego — przerwany krok nie zostawia niepełnego pliku.
psql_to() { local out="$1"; shift; psql "$OLD_DB_URL" "$@" > "$out.tmp"; mv "$out.tmp" "$out"; }

log "Role"
have "$D/roles.sql" || supabase db dump "$T" -f "$D/roles.sql" --role-only
log "Schemat"
have "$D/schema.sql" || supabase db dump "$T" -f "$D/schema.sql"
log "Dane (bez plików Storage, sekretów Vault, cronów i kolejek pg_net — przenoszą je osobne kroki)"
have "$D/data.sql" || supabase db dump "$T" -f "$D/data.sql" --use-copy --data-only \
  -x storage.buckets -x storage.objects -x storage.prefixes \
  -x storage.s3_multipart_uploads -x storage.s3_multipart_uploads_parts \
  -x storage.buckets_analytics -x storage.buckets_vectors -x storage.vector_indexes \
  -x vault.secrets -x cron.job -x cron.job_run_details \
  -x net.http_request_queue -x net._http_response
log "Historia migracji"
have "$D/history_schema.sql" || supabase db dump "$T" -f "$D/history_schema.sql" --schema supabase_migrations
have "$D/history_data.sql" || supabase db dump "$T" -f "$D/history_data.sql" --use-copy --data-only --schema supabase_migrations

log "Reguły plików i Realtime, wyzwalacze auth, publikacja"
psql_to "$D/platform.sql" -X -q -At -v ON_ERROR_STOP=1 -f "$HERE/sql/extract-platform.sql"
log "Crony"
if [ -s "$W/cron-frozen.sql" ]; then
  cp "$W/cron-frozen.sql" "$D/cron.sql"   # dzień przełączenia: lista sprzed zatrzymania
else
  psql_to "$D/cron.sql" -X -q -At -v ON_ERROR_STOP=1 -f "$HERE/sql/extract-cron.sql"
fi
log "Liczby wierszy (do porównania po odtworzeniu)"
psql_to "$D/counts-old.tsv" -X -q -At -F $'\t' -v ON_ERROR_STOP=1 -f "$HERE/sql/counts.sql"

log "Gotowe: $D"
ls -lh "$D"
