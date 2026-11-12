-- Pliki wydarzeń w Finderze (Mavinci → Eventy → rok → „RRRR-MM-DD Nazwa” → foldery z zakładki Pliki), etap 1 — serwer.
--
-- • Wersje: `content_version` rośnie przy podmianie treści (nowy obiekt w magazynie), `meta_version` przy zmianie nazwy lub
--   folderu, `content_sha256` to skrót treści liczony na Macu, a `updated_at` zmienia się przy każdej zmianie wiersza.
--   To podstawa synchronizacji („co się zmieniło od…”) i wykrywania konfliktów (dwie osoby edytują ten sam plik).
-- • `event_file_versions`: poprzednie treści pliku (obiekt w magazynie zostaje, sprząta go serwer po 30 dniach).
-- • `event_file_tombstones`: ślady usunięć plików i folderów, żeby Finder usunął je u siebie.
-- • `event_file_trash`: kosz na 30 dni. Każde usunięcie folderu i pliku (gdy jego obiekt jest jeszcze w magazynie) trafia tu
--   automatycznie przez wyzwalacz. Przywraca `restore_event_trash` z uprawnieniami użytkownika (RLS jak przy dodawaniu plików).
--   Pliki usunięte razem z folderem przywracają się razem z nim.
--
-- Wpisy w koszu, wersjach i śladach tworzą wyłącznie wyzwalacze (bez polityk insert / update). Wyzwalacze usuwania nie mogą
-- zablokować usuwania w CRM — błąd w nich jest tylko ostrzeżeniem w logach bazy.
-- Migracja jest idempotentna — można ją uruchomić ponownie.

begin;

-- 1. Wersje w event_files / event_folders ---------------------------------------------------------------------------------

alter table public.event_files
  add column if not exists content_sha256 text,
  add column if not exists content_version integer not null default 1,
  add column if not exists meta_version integer not null default 1;

alter table public.event_folders
  add column if not exists meta_version integer not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'event_files_content_sha256_check') then
    alter table public.event_files
      add constraint event_files_content_sha256_check check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$');
  end if;
end $$;

create index if not exists event_files_updated_at_idx on public.event_files (updated_at);
create index if not exists event_folders_updated_at_idx on public.event_folders (updated_at);

-- 2. Ślady usunięć ----------------------------------------------------------------------------------------------------------

create table if not exists public.event_file_tombstones (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('file', 'folder')),
  item_id uuid not null,
  event_id uuid not null,
  deleted_at timestamptz not null default now()
);

create index if not exists event_file_tombstones_deleted_idx on public.event_file_tombstones (deleted_at);

alter table public.event_file_tombstones enable row level security;

drop policy if exists event_file_tombstones_read on public.event_file_tombstones;
create policy event_file_tombstones_read on public.event_file_tombstones
  for select to authenticated using (public.current_employee_can_view_event(event_id));

drop policy if exists event_file_tombstones_seller_portal_deny on public.event_file_tombstones;
create policy event_file_tombstones_seller_portal_deny on public.event_file_tombstones
  as restrictive for all to authenticated using (not public.current_session_is_seller_portal());

-- 3. Kosz ---------------------------------------------------------------------------------------------------------------------

create table if not exists public.event_file_trash (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('file', 'folder')),
  item_id uuid not null,
  event_id uuid not null,
  parent_folder_id uuid,
  name text not null default '',
  file_path text,
  file_size bigint,
  mime_type text,
  document_type text,
  snapshot jsonb not null,
  batch bigint not null,
  deleted_at timestamptz not null default now(),
  deleted_by uuid,
  purge_after timestamptz not null default now() + interval '30 days'
);

create index if not exists event_file_trash_event_idx on public.event_file_trash (event_id, deleted_at desc);
create index if not exists event_file_trash_batch_idx on public.event_file_trash (batch, event_id);
create index if not exists event_file_trash_purge_idx on public.event_file_trash (purge_after);

alter table public.event_file_trash enable row level security;

-- Widzi i usuwa na zawsze ten, kto mógł usunąć oryginał (jak polityki usuwania w event_files).
drop policy if exists event_file_trash_read on public.event_file_trash;
create policy event_file_trash_read on public.event_file_trash
  for select to authenticated
  using (
    public.crm_record_id_scope_allows('events', event_id)
    and (kind = 'folder' or public.sales_finance_file_access(coalesce(file_path, ''), document_type, false))
    and (
      public.can_view_private_event_content(event_id, auth.uid())
      or (kind = 'file' and parent_folder_id is null and not public.is_sensitive_event_document(document_type)
          and public.can_edit_operational_event_files(event_id, auth.uid()))
    )
  );

drop policy if exists event_file_trash_delete on public.event_file_trash;
create policy event_file_trash_delete on public.event_file_trash
  for delete to authenticated
  using (
    public.crm_record_id_scope_allows('events', event_id)
    and (kind = 'folder' or public.sales_finance_file_access(coalesce(file_path, ''), document_type, true))
    and (
      public.can_view_private_event_content(event_id, auth.uid())
      or (kind = 'file' and parent_folder_id is null and not public.is_sensitive_event_document(document_type)
          and public.can_edit_operational_event_files(event_id, auth.uid()))
    )
  );

drop policy if exists event_file_trash_seller_portal_deny on public.event_file_trash;
create policy event_file_trash_seller_portal_deny on public.event_file_trash
  as restrictive for all to authenticated using (not public.current_session_is_seller_portal());

-- 4. Poprzednie treści plików ---------------------------------------------------------------------------------------------

-- Bez klucza obcego: po usunięciu pliku jego wersje czekają razem z nim w koszu (wracają przy przywróceniu,
-- sprząta je serwer razem z wpisem kosza).
create table if not exists public.event_file_versions (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null,
  event_id uuid not null,
  file_path text not null,
  file_size bigint,
  mime_type text,
  content_sha256 text,
  content_version integer not null,
  replaced_at timestamptz not null default now(),
  replaced_by uuid
);

create index if not exists event_file_versions_file_idx on public.event_file_versions (file_id, content_version desc);
create index if not exists event_file_versions_replaced_idx on public.event_file_versions (replaced_at);

alter table public.event_file_versions enable row level security;

-- Widzi ten, kto widzi plik (albo jego wpis w koszu) — podzapytania podlegają RLS tych tabel.
drop policy if exists event_file_versions_read on public.event_file_versions;
create policy event_file_versions_read on public.event_file_versions
  for select to authenticated
  using (
    exists (select 1 from public.event_files f where f.id = event_file_versions.file_id)
    or exists (select 1 from public.event_file_trash t where t.kind = 'file' and t.item_id = event_file_versions.file_id)
  );

-- Sprzątanie: wersje starsze niż 30 dni plików, które użytkownik widzi, oraz wersje plików usuwanych z kosza.
drop policy if exists event_file_versions_purge on public.event_file_versions;
create policy event_file_versions_purge on public.event_file_versions
  for delete to authenticated
  using (
    (replaced_at < now() - interval '30 days'
      and exists (select 1 from public.event_files f where f.id = event_file_versions.file_id))
    or exists (select 1 from public.event_file_trash t where t.kind = 'file' and t.item_id = event_file_versions.file_id)
  );

drop policy if exists event_file_versions_seller_portal_deny on public.event_file_versions;
create policy event_file_versions_seller_portal_deny on public.event_file_versions
  as restrictive for all to authenticated using (not public.current_session_is_seller_portal());

revoke all on public.event_file_versions, public.event_file_tombstones, public.event_file_trash from anon;
revoke insert, update, truncate, references, trigger on public.event_file_versions, public.event_file_tombstones, public.event_file_trash from authenticated;
grant select, delete on public.event_file_versions to authenticated;
grant select on public.event_file_tombstones to authenticated;
revoke delete on public.event_file_tombstones from authenticated;
grant select, delete on public.event_file_trash to authenticated;

-- 5. Wyzwalacze zmian -------------------------------------------------------------------------------------------------------

create or replace function private.event_files_track_versions()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  new.updated_at := now();
  new.content_version := coalesce(old.content_version, 1);
  new.meta_version := coalesce(old.meta_version, 1);
  if new.file_path is distinct from old.file_path then
    new.content_version := new.content_version + 1;
    if coalesce(old.file_path, '') <> '' then
      insert into public.event_file_versions (file_id, event_id, file_path, file_size, mime_type, content_sha256, content_version, replaced_by)
      values (old.id, old.event_id, old.file_path, old.file_size, old.mime_type, old.content_sha256,
              coalesce(old.content_version, 1), public.current_employee_id());
    end if;
  elsif old.content_sha256 is not null then
    -- Skrót zmienia się tylko razem z treścią (pusty można uzupełnić, np. po pierwszym pobraniu na Macu).
    new.content_sha256 := old.content_sha256;
  end if;
  if new.name is distinct from old.name or new.folder_id is distinct from old.folder_id then
    new.meta_version := new.meta_version + 1;
  end if;
  return new;
end $$;

drop trigger if exists zz_event_files_track_versions on public.event_files;
create trigger zz_event_files_track_versions
  before update on public.event_files
  for each row execute function private.event_files_track_versions();

create or replace function private.event_folders_track_versions()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  new.updated_at := now();
  new.meta_version := coalesce(old.meta_version, 1);
  if new.name is distinct from old.name or new.parent_folder_id is distinct from old.parent_folder_id then
    new.meta_version := new.meta_version + 1;
  end if;
  return new;
end $$;

drop trigger if exists zz_event_folders_track_versions on public.event_folders;
create trigger zz_event_folders_track_versions
  before update on public.event_folders
  for each row execute function private.event_folders_track_versions();

-- 6. Wyzwalacze usuwania: ślad + kosz ---------------------------------------------------------------------------------------
-- Plik trafia do kosza tylko wtedy, gdy jego obiekt jest jeszcze w magazynie (regeneracja PDF-ów usuwa najpierw obiekt —
-- takie podmiany nie zaśmiecają kosza). Usunięcie całego wydarzenia nie tworzy wpisów w koszu.

create or replace function private.event_files_after_delete()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  begin
    if old.event_id is not null then
      insert into public.event_file_tombstones (kind, item_id, event_id) values ('file', old.id, old.event_id);
      if exists (select 1 from public.events e where e.id = old.event_id)
         and coalesce(old.file_path, '') <> ''
         and exists (select 1 from storage.objects o where o.bucket_id = 'event-files' and o.name = old.file_path) then
        insert into public.event_file_trash
          (kind, item_id, event_id, parent_folder_id, name, file_path, file_size, mime_type, document_type, snapshot, batch, deleted_by)
        values
          ('file', old.id, old.event_id, old.folder_id, coalesce(nullif(old.name, ''), nullif(old.original_name, ''), 'plik'),
           old.file_path, old.file_size, old.mime_type, old.document_type, to_jsonb(old), txid_current(), public.current_employee_id());
      end if;
    end if;
  exception when others then
    raise warning 'event_files_after_delete %: %', old.id, sqlerrm;
  end;
  return old;
end $$;

drop trigger if exists zz_event_files_after_delete on public.event_files;
create trigger zz_event_files_after_delete
  after delete on public.event_files
  for each row execute function private.event_files_after_delete();

create or replace function private.event_folders_after_delete()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  begin
    if old.event_id is not null then
      insert into public.event_file_tombstones (kind, item_id, event_id) values ('folder', old.id, old.event_id);
      if exists (select 1 from public.events e where e.id = old.event_id) then
        insert into public.event_file_trash (kind, item_id, event_id, parent_folder_id, name, snapshot, batch, deleted_by)
        values ('folder', old.id, old.event_id, old.parent_folder_id, coalesce(old.name, ''), to_jsonb(old), txid_current(),
                public.current_employee_id());
      end if;
    end if;
  exception when others then
    raise warning 'event_folders_after_delete %: %', old.id, sqlerrm;
  end;
  return old;
end $$;

drop trigger if exists zz_event_folders_after_delete on public.event_folders;
create trigger zz_event_folders_after_delete
  after delete on public.event_folders
  for each row execute function private.event_folders_after_delete();

-- 7. Przywracanie z kosza (uprawnienia użytkownika) --------------------------------------------------------------------------

create or replace function public.restore_event_trash(p_ids uuid[])
returns jsonb
language plpgsql
security invoker
set search_path to 'pg_catalog', 'public'
as $$
declare
  t record;
  v_ids uuid[];
  v_row jsonb;
  v_name text;
  v_suffix text;
  v_try integer;
  v_restored integer := 0;
  v_missing integer := 0;
  v_skipped integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Wymagane logowanie.' using errcode = '42501';
  end if;

  -- Folder wraca razem ze wszystkim, co usunięto w tej samej operacji (podfoldery i pliki w środku).
  select array_agg(distinct x.id) into v_ids
  from public.event_file_trash x
  where x.id = any(p_ids)
     or exists (select 1 from public.event_file_trash f
                where f.id = any(p_ids) and f.kind = 'folder' and f.batch = x.batch and f.event_id = x.event_id);

  if v_ids is null then
    return jsonb_build_object('restored', 0, 'missing', 0, 'skipped', 0);
  end if;

  for t in
    select * from public.event_file_trash x
    where x.id = any(v_ids)
    order by (x.kind = 'folder') desc,
             coalesce(array_length(string_to_array(x.snapshot ->> 'path', '/'), 1), 1),
             x.deleted_at
  loop
    if not exists (select 1 from public.events e where e.id = t.event_id) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_row := t.snapshot || jsonb_build_object('updated_at', now());

    if t.kind = 'folder' then
      if exists (select 1 from public.event_folders f where f.id = t.item_id) then
        delete from public.event_file_trash where id = t.id;
        continue;
      end if;
      if t.parent_folder_id is not null and not exists (select 1 from public.event_folders f where f.id = t.parent_folder_id) then
        v_row := v_row || jsonb_build_object('parent_folder_id', null);
      end if;
    else
      if exists (select 1 from public.event_files f where f.id = t.item_id) then
        delete from public.event_file_trash where id = t.id;
        continue;
      end if;
      if not exists (select 1 from storage.objects o where o.bucket_id = 'event-files' and o.name = t.file_path) then
        v_missing := v_missing + 1;
        continue;
      end if;
      if t.parent_folder_id is not null and not exists (select 1 from public.event_folders f where f.id = t.parent_folder_id) then
        v_row := v_row || jsonb_build_object('folder_id', null);
      end if;
    end if;

    -- Ta sama nazwa jest już w miejscu docelowym (także w głównym folderze wydarzenia, gdzie baza nie pilnuje unikalności)
    -- → „Nazwa (przywrócony).pdf”, „Nazwa (przywrócony 2).pdf”…
    v_name := t.name;
    v_try := 0;
    while v_try < 20 and (
      (t.kind = 'folder' and exists (
        select 1 from public.event_folders f
        where f.event_id = t.event_id and f.name = v_name
          and f.parent_folder_id is not distinct from (v_row ->> 'parent_folder_id')::uuid))
      or (t.kind = 'file' and exists (
        select 1 from public.event_files f
        where f.event_id = t.event_id and f.name = v_name
          and f.folder_id is not distinct from (v_row ->> 'folder_id')::uuid))
    ) loop
      v_try := v_try + 1;
      v_suffix := ' (przywrócony' || case when v_try > 1 then ' ' || v_try else '' end || ')';
      v_name := case
        when t.kind = 'file' and t.name ~ '\.[A-Za-z0-9]{1,12}$'
          then regexp_replace(t.name, '(\.[A-Za-z0-9]{1,12})$', v_suffix || '\1')
        else t.name || v_suffix
      end;
    end loop;
    v_row := v_row || jsonb_build_object('name', v_name);

    begin
      if t.kind = 'folder' then
        insert into public.event_folders select (jsonb_populate_record(null::public.event_folders, v_row)).*;
      else
        insert into public.event_files select (jsonb_populate_record(null::public.event_files, v_row)).*;
      end if;
    exception when unique_violation then
      raise exception 'Nie udało się przywrócić „%” — ta nazwa jest już zajęta.', t.name using errcode = '23505';
    end;

    delete from public.event_file_trash where id = t.id;
    v_restored := v_restored + 1;
  end loop;

  return jsonb_build_object('restored', v_restored, 'missing', v_missing, 'skipped', v_skipped);
end $$;

revoke all on function public.restore_event_trash(uuid[]) from public, anon;
grant execute on function public.restore_event_trash(uuid[]) to authenticated;

-- Ślady usunięć starsze niż 90 dni (Mac przy tak starym punkcie synchronizacji i tak wczytuje wszystko od nowa).
create or replace function public.purge_event_file_tombstones()
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Wymagane logowanie.' using errcode = '42501';
  end if;
  delete from public.event_file_tombstones where deleted_at < now() - interval '90 days';
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.purge_event_file_tombstones() from public, anon;
grant execute on function public.purge_event_file_tombstones() to authenticated;

-- Które z podanych obiektów magazynu są nadal w użyciu (plik wydarzenia, PDF faktury) — serwer usuwa z magazynu tylko
-- obiekty nieużywane, niezależnie od tego, które wiersze widzi użytkownik sprzątający kosz.
create or replace function public.event_file_paths_in_use(p_paths text[])
returns text[]
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select coalesce(array_agg(distinct p), '{}'::text[])
  from unnest(p_paths) as p
  where auth.uid() is not null
    and (exists (select 1 from public.event_files f where f.file_path = p)
      or exists (select 1 from public.event_file_trash t where t.file_path = p)
      or exists (select 1 from public.event_file_versions v where v.file_path = p)
      or exists (select 1 from public.invoices i where public.invoice_event_storage_path(i.pdf_url) = p));
$$;

revoke all on function public.event_file_paths_in_use(text[]) from public, anon;
grant execute on function public.event_file_paths_in_use(text[]) to authenticated;

commit;
