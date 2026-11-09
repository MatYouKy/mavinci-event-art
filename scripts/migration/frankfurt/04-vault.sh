#!/usr/bin/env bash
# Sekrety Vault w NOWYM projekcie (zaszyfrowanych kopii nie da się przenieść — tworzymy je od nowa).
# Te same nazwy co w starym projekcie; wartości: nowy adres, nowe klucze, nowy losowy sekret workera e-maili.
source "$(dirname "$0")/lib.sh"
need_cmd psql "brew install postgresql@17"
need_cmd openssl "openssl"
ask_db_url NEW_DB_URL NOWEGO
ask NEW_REF "Identyfikator NOWEGO projektu"
ask NEW_ANON_KEY "Klucz anon / publishable NOWEGO projektu" secret
ask NEW_SERVICE_ROLE_KEY "Klucz service_role / secret NOWEGO projektu" secret
check_key NEW_ANON_KEY
check_key NEW_SERVICE_ROLE_KEY
export NEW_PROJECT_URL="https://${NEW_REF}.supabase.co"
WORKER_SECRET="$(openssl rand -hex 32)"
export WORKER_SECRET

psql "$NEW_DB_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL'
\getenv url NEW_PROJECT_URL
\getenv anon NEW_ANON_KEY
\getenv service NEW_SERVICE_ROLE_KEY
\getenv worker WORKER_SECRET
select vault.create_secret(:'url', 'ksef_daily_project_url') where not exists (select 1 from vault.secrets where name = 'ksef_daily_project_url');
select vault.update_secret(id, :'url') from vault.secrets where name = 'ksef_daily_project_url';
select vault.create_secret(:'service', 'ksef_daily_service_role_key') where not exists (select 1 from vault.secrets where name = 'ksef_daily_service_role_key');
select vault.update_secret(id, :'service') from vault.secrets where name = 'ksef_daily_service_role_key';
select vault.create_secret(:'anon', 'supabase_anon_key') where not exists (select 1 from vault.secrets where name = 'supabase_anon_key');
select vault.update_secret(id, :'anon') from vault.secrets where name = 'supabase_anon_key';
select vault.create_secret(:'worker', 'scheduled_email_worker_secret') where not exists (select 1 from vault.secrets where name = 'scheduled_email_worker_secret');
select vault.update_secret(id, :'worker') from vault.secrets where name = 'scheduled_email_worker_secret';
\pset tuples_only on
select 'Vault: ' || string_agg(name, ', ' order by name) from vault.secrets;
SQL
