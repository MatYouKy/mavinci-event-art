#!/usr/bin/env bash
# Przygotowanie zrzutu dla NOWEGO projektu: adres starego projektu → nowy (dane, funkcje, polityki, crony),
# poprawki z dokumentacji Supabase (właściciel supabase_admin, rola cli_login_postgres, publikacja Realtime).
source "$(dirname "$0")/lib.sh"
need_cmd perl "perl (jest w macOS)"
ask NEW_REF "Identyfikator NOWEGO projektu (20 znaków z adresu https://<id>.supabase.co)"
case "$NEW_REF" in *[!a-z0-9]*|"") echo "Nieprawidłowy identyfikator: $NEW_REF"; exit 1;; esac
D="$(latest_dump)"

for f in schema data platform cron history_schema history_data; do
  sed "s/${OLD_REF}/${NEW_REF}/g" "$D/$f.sql" > "$D/$f.prepared.sql"
done
# Supabase: „ALTER ... OWNER TO supabase_admin” i GRANT dla cli_login_postgres kończą się błędem uprawnień.
perl -pe 's/^(GRANT "?postgres"? TO "?cli_login_postgres"?.*)$/-- $1/' "$D/roles.sql" > "$D/roles.prepared.sql"
# Publikację supabase_realtime ma już nowy projekt — tabele dodaje platform.sql (bez konfliktu).
perl -pi -e 's/^(ALTER .* OWNER TO "?supabase_admin"?;)$/-- $1/; s/^((CREATE|ALTER) PUBLICATION "?supabase_realtime"?.*)$/-- $1/' "$D/schema.prepared.sql"

log "Kontrola: stary adres w przygotowanych plikach (powinno być 0)"
for f in "$D"/*.prepared.sql; do printf '%6s  %s\n' "$(grep -c "$OLD_REF" "$f" || true)" "$(basename "$f")"; done
echo "$NEW_REF" > "$D/new-ref.txt"
echo "Gotowe — dalej 03-restore.sh"
