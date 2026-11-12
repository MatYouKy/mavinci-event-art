-- Usunięcie starej synchronizacji folderów aplikacji „Mavinci Reminders” (`macos-sync-app`, `/bridge/mac-sync/*`):
-- zastąpiła ją aplikacja na Maca z „Mavinci” w Finderze (File Provider na `event_files`, migracja
-- `20261112120000_finder_files_sync.sql`). Tabele są puste — migracja przerywa się, gdyby jednak miały dane.
-- Pusty kosz magazynu „mac-crm-sync” można usunąć w panelu Supabase (Storage) — SQL nie usuwa koszy.
-- Migracja jest idempotentna — można ją uruchomić ponownie.

begin;

do $$
declare
  t text;
  has_rows boolean;
begin
  foreach t in array array['mac_sync_bindings', 'mac_sync_files', 'mac_sync_file_versions'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select exists (select 1 from public.%I)', t) into has_rows;
      if has_rows then
        raise exception '% zawiera dane — przerwano usuwanie starej synchronizacji', t;
      end if;
    end if;
  end loop;
end $$;

drop function if exists public.commit_mac_sync_file(uuid, uuid, text, text, text, bigint, text, integer);
drop table if exists public.mac_sync_file_versions;
drop table if exists public.mac_sync_files;
drop table if exists public.mac_sync_bindings;

commit;
