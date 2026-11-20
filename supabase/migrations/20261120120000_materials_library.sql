-- Materiały — baza plików firmy (Etap 1: baza danych). Logotypy, zdjęcia, wideo, prezentacje, dokumenty i materiały do
-- social media każdej marki w jednym miejscu: CRM (`/crm/materials`), a w kolejnych etapach Finder (Mavinci → Materiały),
-- aplikacja na Maca i telefon. Wszystko przez `/bridge/native/v1/materials` tokenem pracownika — RLS jak w CRM.
--
-- Uprawnienia (Ustawienia → Poziomy dostępu → sekcja „Materiały”, profil pracownika → Uprawnienia):
--   materials_view   — przeglądanie, podgląd i pobieranie materiałów przypisanych marek,
--   materials_manage — wgrywanie, foldery, zmiana nazwy, przenoszenie, opisy, kosz (obejmuje podgląd).
-- Administrator ma wszystko; sprzedawca z portalu — nic. Zakres marek jak w marketingu (`employees.my_company_ids`, pusty =
-- wszystkie marki). Pliki wydarzeń w wyszukiwaniu Materiałów widać według dostępu do wydarzeń (RLS `event_files`).
--
-- • `material_folders` — drzewo folderów marki; domyślne foldery (`system_key`) powstają dla każdej marki, nie da się ich
--   usunąć ani przenieść (nazwę można zmienić). Nazwy unikalne w folderze bez względu na wielkość liter, plik i folder
--   nie mogą mieć tej samej nazwy w jednym miejscu (jak w Finderze).
-- • `material_files` — plik w prywatnym buckecie `materials` (`<marka>/<plik>/<los>.<rozszerzenie>`, do 2 GB), miniatura
--   obok (`…/t-<los>.jpg`). `status = 'uploading'` do potwierdzenia wysyłki. `content_version` rośnie przy podmianie treści
--   (poprzednia zostaje w `material_file_versions` na 30 dni), `meta_version` przy zmianie nazwy lub folderu.
-- • `material_trash` — kosz na 30 dni (wyzwalacz przy każdym usunięciu; folder wraca razem z zawartością usuniętą w tej
--   samej operacji), `material_tombstones` — ślady usunięć dla synchronizacji Findera.
-- Wpisy w koszu, wersjach i śladach tworzą wyłącznie wyzwalacze. Obiekty w magazynie usuwa serwer CRM (tylko nieużywane).
-- Plik idempotentny — można go wykonać ponownie.

begin;

-- 1. Dostęp ---------------------------------------------------------------------------------------------------------------

-- Czy bieżący pracownik ma zakres `p_scope` (view | manage) w marce `p_company` (`NULL` — w którejkolwiek marce).
create or replace function public.materials_can(p_company uuid, p_scope text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce((
    select not public.current_session_is_seller_portal() and (
      e.role::text = 'admin' or e.access_level::text = 'admin' or 'admin' = any(coalesce(e.permissions, '{}'::text[]))
      or (
        (p_company is null or cardinality(coalesce(e.my_company_ids, '{}'::uuid[])) = 0
          or p_company = any(coalesce(e.my_company_ids, '{}'::uuid[])))
        and coalesce(e.permissions, '{}'::text[]) && case p_scope
          when 'view' then array['materials_view', 'materials_manage']
          when 'manage' then array['materials_manage']
          else array[]::text[]
        end
      )
    )
    from public.employees e
    where e.id = public.current_crm_employee_id()
  ), false);
$$;

revoke all on function public.materials_can(uuid, text) from public, anon;
grant execute on function public.materials_can(uuid, text) to authenticated, service_role;

-- Zakresy bieżącego pracownika w marce — przyciski w CRM, na Macu i w telefonie (te same reguły co RLS).
create or replace function public.materials_access(p_company uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'view', public.materials_can(p_company, 'view'),
    'manage', public.materials_can(p_company, 'manage'),
    'admin', public.current_employee_is_crm_admin(),
    'employeeId', public.current_crm_employee_id()
  );
$$;

revoke all on function public.materials_access(uuid) from public, anon;
grant execute on function public.materials_access(uuid) to authenticated, service_role;

-- 2. Foldery ----------------------------------------------------------------------------------------------------------------

create table if not exists public.material_folders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.my_companies(id) on delete cascade,
  parent_id uuid references public.material_folders(id) on delete cascade,
  name text not null,
  system_key text,
  sort_order integer not null default 0,
  meta_version integer not null default 1,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint material_folders_name_check
    check (char_length(name) between 1 and 255 and name = btrim(name) and name !~ '[[:cntrl:]]' and name not in ('.', '..')),
  constraint material_folders_system_key_check
    check (system_key is null or system_key in ('brand', 'photos', 'video', 'presentations', 'documents', 'social')),
  constraint material_folders_parent_check check (parent_id is null or parent_id <> id)
);

create unique index if not exists material_folders_name_key
  on public.material_folders (company_id, parent_id, lower(name)) nulls not distinct;
create unique index if not exists material_folders_system_key
  on public.material_folders (company_id, system_key) where system_key is not null;
create index if not exists material_folders_parent_idx on public.material_folders (parent_id);
create index if not exists material_folders_updated_idx on public.material_folders (updated_at);

-- 3. Pliki ------------------------------------------------------------------------------------------------------------------

create table if not exists public.material_files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.my_companies(id) on delete cascade,
  folder_id uuid references public.material_folders(id) on delete cascade,
  name text not null,
  status text not null default 'uploading',
  storage_path text not null,
  thumbnail_path text,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0,
  content_sha256 text,
  content_version integer not null default 1,
  meta_version integer not null default 1,
  width integer,
  height integer,
  duration_seconds numeric(10, 2),
  description text not null default '',
  tags text[] not null default '{}'::text[],
  event_id uuid references public.events(id) on delete set null,
  source_event_file_id uuid,
  created_by uuid references public.employees(id) on delete set null,
  updated_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint material_files_name_check
    check (char_length(name) between 1 and 255 and name = btrim(name) and name !~ '[[:cntrl:]]' and name not in ('.', '..')),
  constraint material_files_status_check check (status in ('uploading', 'ready')),
  constraint material_files_size_check check (size_bytes between 0 and 2147483648),
  constraint material_files_mime_check check (char_length(mime_type) between 1 and 200),
  constraint material_files_sha_check check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint material_files_path_check
    check (storage_path ~ '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}/[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}/[A-Za-z0-9._-]{1,80}$'),
  constraint material_files_thumb_check
    check (thumbnail_path is null
      or thumbnail_path ~ '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}/[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}/[A-Za-z0-9._-]{1,80}$'),
  constraint material_files_dimensions_check
    check ((width is null or width > 0) and (height is null or height > 0) and (duration_seconds is null or duration_seconds >= 0)),
  constraint material_files_description_check check (char_length(description) <= 2000),
  constraint material_files_tags_check check (cardinality(tags) <= 30)
);

create unique index if not exists material_files_name_key
  on public.material_files (company_id, folder_id, lower(name)) nulls not distinct;
create unique index if not exists material_files_path_key on public.material_files (storage_path);
create index if not exists material_files_folder_idx on public.material_files (folder_id);
create index if not exists material_files_company_idx on public.material_files (company_id, updated_at desc);
create index if not exists material_files_updated_idx on public.material_files (updated_at);
create index if not exists material_files_sha_idx on public.material_files (company_id, content_sha256) where content_sha256 is not null;
create index if not exists material_files_event_idx on public.material_files (event_id) where event_id is not null;
create index if not exists material_files_source_idx on public.material_files (source_event_file_id) where source_event_file_id is not null;
create index if not exists material_files_uploading_idx on public.material_files (created_at) where status = 'uploading';

-- 4. Poprzednie treści, kosz, ślady usunięć -------------------------------------------------------------------------------

-- Bez klucza obcego: po usunięciu pliku jego wersje czekają razem z nim w koszu (wracają przy przywróceniu).
create table if not exists public.material_file_versions (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null,
  company_id uuid not null,
  storage_path text not null,
  thumbnail_path text,
  size_bytes bigint,
  mime_type text,
  content_sha256 text,
  content_version integer not null,
  width integer,
  height integer,
  replaced_at timestamptz not null default now(),
  replaced_by uuid
);

create index if not exists material_file_versions_file_idx on public.material_file_versions (file_id, content_version desc);
create index if not exists material_file_versions_replaced_idx on public.material_file_versions (replaced_at);

create table if not exists public.material_trash (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('file', 'folder')),
  item_id uuid not null,
  company_id uuid not null,
  parent_folder_id uuid,
  name text not null default '',
  storage_path text,
  thumbnail_path text,
  size_bytes bigint,
  mime_type text,
  snapshot jsonb not null,
  batch bigint not null,
  deleted_at timestamptz not null default now(),
  deleted_by uuid,
  purge_after timestamptz not null default now() + interval '30 days'
);

create index if not exists material_trash_company_idx on public.material_trash (company_id, deleted_at desc);
create index if not exists material_trash_batch_idx on public.material_trash (batch, company_id);
create index if not exists material_trash_item_idx on public.material_trash (item_id);
create index if not exists material_trash_purge_idx on public.material_trash (purge_after);

create table if not exists public.material_tombstones (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('file', 'folder')),
  item_id uuid not null,
  company_id uuid not null,
  deleted_at timestamptz not null default now()
);

create index if not exists material_tombstones_deleted_idx on public.material_tombstones (deleted_at);

-- 5. Wyzwalacze zapisu ----------------------------------------------------------------------------------------------------
-- Domyślne foldery marki zakłada i oznacza wyłącznie `material_default_folders` (flaga transakcji `mavinci.materials_system`).

create or replace function public.material_folders_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_system boolean := coalesce(current_setting('mavinci.materials_system', true), '') = 'on';
  v_parent_company uuid;
  v_cursor uuid;
  v_depth integer := 0;
begin
  -- Zmiana wprost przez pracownika (nie kaskada kluczy obcych): uprawnienie sprawdzane przed komunikatami o nazwach.
  if not v_system and pg_trigger_depth() = 1 and auth.uid() is not null
     and not public.materials_can(case when tg_op = 'UPDATE' then old.company_id else new.company_id end, 'manage') then
    raise exception 'Nie masz uprawnień do zmian w materiałach tej marki.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if new.company_id is distinct from old.company_id then
      raise exception 'Folderu nie można przenieść do innej marki.' using errcode = '22023';
    end if;
    if new.system_key is distinct from old.system_key and not v_system then
      raise exception 'Nie można zmienić folderu domyślnego marki.' using errcode = '22023';
    end if;
    if coalesce(old.system_key, new.system_key) is not null and new.parent_id is distinct from old.parent_id then
      raise exception 'Folderu domyślnego marki nie można przenieść.' using errcode = '22023';
    end if;
    new.id := old.id;
    new.created_at := old.created_at;
    -- Autor bez zmian; wyzerowanie zostaje (usunięcie konta pracownika — kaskada klucza obcego).
    new.created_by := case when new.created_by is null then null else old.created_by end;
    new.meta_version := coalesce(old.meta_version, 1);
    if new.name is distinct from old.name or new.parent_id is distinct from old.parent_id then
      new.meta_version := new.meta_version + 1;
    end if;
  else
    if new.system_key is not null and not v_system then
      raise exception 'Folder domyślny marki tworzy system.' using errcode = '22023';
    end if;
    new.created_by := coalesce(new.created_by, public.current_crm_employee_id());
    new.meta_version := greatest(coalesce(new.meta_version, 1), 1);
  end if;
  new.updated_at := now();

  if new.system_key is not null and new.parent_id is not null then
    raise exception 'Folder domyślny marki musi być w głównym folderze marki.' using errcode = '22023';
  end if;

  if new.parent_id is not null then
    select f.company_id into v_parent_company from public.material_folders f where f.id = new.parent_id;
    if not found then
      raise exception 'Nie znaleziono folderu nadrzędnego.' using errcode = '23503';
    end if;
    if v_parent_company <> new.company_id then
      raise exception 'Folder nadrzędny należy do innej marki.' using errcode = '22023';
    end if;
    v_cursor := new.parent_id;
    while v_cursor is not null loop
      if v_cursor = new.id then
        raise exception 'Nie można przenieść folderu do jego własnego podfolderu.' using errcode = '22023';
      end if;
      v_depth := v_depth + 1;
      if v_depth > 30 then
        raise exception 'Za dużo poziomów folderów (najwięcej 30).' using errcode = '22023';
      end if;
      select f.parent_id into v_cursor from public.material_folders f where f.id = v_cursor;
    end loop;
  end if;

  -- Plik i folder o tej samej nazwie w jednym miejscu (Finder na to nie pozwala).
  if tg_op = 'INSERT' or new.name is distinct from old.name or new.parent_id is distinct from old.parent_id then
    perform pg_advisory_xact_lock(hashtextextended('materials:' || new.company_id::text || ':' || coalesce(new.parent_id::text, ''), 0));
    if exists (select 1 from public.material_files f
               where f.company_id = new.company_id and f.folder_id is not distinct from new.parent_id
                 and lower(f.name) = lower(new.name)) then
      raise exception 'Plik o tej nazwie jest już w tym miejscu.' using errcode = '23505';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists material_folders_guard on public.material_folders;
create trigger material_folders_guard
  before insert or update on public.material_folders
  for each row execute function public.material_folders_guard();

-- Folderów domyślnych nie można usunąć (poza usunięciem całej marki).
create or replace function public.material_folders_before_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.system_key is not null and exists (select 1 from public.my_companies c where c.id = old.company_id) then
    raise exception 'Folderu domyślnego marki nie można usunąć.' using errcode = '22023';
  end if;
  return old;
end $$;

drop trigger if exists material_folders_before_delete on public.material_folders;
create trigger material_folders_before_delete
  before delete on public.material_folders
  for each row execute function public.material_folders_before_delete();

create or replace function public.material_files_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := public.current_crm_employee_id();
  v_prefix text;
  v_folder_company uuid;
begin
  -- Zmiana wprost przez pracownika (nie kaskada kluczy obcych): uprawnienie sprawdzane przed komunikatami o nazwach.
  if pg_trigger_depth() = 1 and auth.uid() is not null
     and not public.materials_can(case when tg_op = 'UPDATE' then old.company_id else new.company_id end, 'manage') then
    raise exception 'Nie masz uprawnień do zmian w materiałach tej marki.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if new.company_id is distinct from old.company_id then
      raise exception 'Pliku nie można przenieść do innej marki.' using errcode = '22023';
    end if;
    if old.status = 'ready' and new.status <> 'ready' then
      raise exception 'Nieprawidłowa zmiana stanu pliku.' using errcode = '22023';
    end if;
    new.id := old.id;
    new.created_at := old.created_at;
    new.created_by := case when new.created_by is null then null else old.created_by end;
    new.content_version := coalesce(old.content_version, 1);
    new.meta_version := coalesce(old.meta_version, 1);
  else
    new.created_by := coalesce(new.created_by, v_actor);
    new.content_version := greatest(coalesce(new.content_version, 1), 1);
    new.meta_version := greatest(coalesce(new.meta_version, 1), 1);
  end if;

  v_prefix := new.company_id::text || '/' || new.id::text || '/';
  if left(new.storage_path, length(v_prefix)) <> v_prefix
     or (new.thumbnail_path is not null and left(new.thumbnail_path, length(v_prefix)) <> v_prefix) then
    raise exception 'Nieprawidłowa ścieżka pliku.' using errcode = '22023';
  end if;

  if tg_op = 'UPDATE' then
    if new.storage_path is distinct from old.storage_path then
      if old.status = 'ready' then
        -- Podmiana treści: poprzednia wersja zostaje na 30 dni.
        new.content_version := new.content_version + 1;
        insert into public.material_file_versions
          (file_id, company_id, storage_path, thumbnail_path, size_bytes, mime_type, content_sha256, content_version, width, height, replaced_by)
        values
          (old.id, old.company_id, old.storage_path, old.thumbnail_path, old.size_bytes, old.mime_type, old.content_sha256,
           coalesce(old.content_version, 1), old.width, old.height, v_actor);
      end if;
    elsif old.status = 'ready' and old.content_sha256 is not null then
      -- Skrót zmienia się tylko razem z treścią (pusty można uzupełnić).
      new.content_sha256 := old.content_sha256;
    end if;
    if new.name is distinct from old.name or new.folder_id is distinct from old.folder_id then
      new.meta_version := new.meta_version + 1;
    end if;
  end if;

  if pg_trigger_depth() = 1 then
    new.updated_by := coalesce(v_actor, new.updated_by);
  end if;
  new.updated_at := now();
  new.description := btrim(coalesce(new.description, ''));
  select coalesce(array_agg(t order by lower(t)), '{}'::text[]) into new.tags
  from (
    select distinct on (lower(left(btrim(x), 40))) left(btrim(x), 40) as t
    from unnest(coalesce(new.tags, '{}'::text[])) as x
    where btrim(x) <> ''
    order by lower(left(btrim(x), 40))
  ) s;

  if new.folder_id is not null then
    select f.company_id into v_folder_company from public.material_folders f where f.id = new.folder_id;
    if not found then
      raise exception 'Nie znaleziono folderu.' using errcode = '23503';
    end if;
    if v_folder_company <> new.company_id then
      raise exception 'Folder należy do innej marki.' using errcode = '22023';
    end if;
  end if;

  if tg_op = 'INSERT' or new.name is distinct from old.name or new.folder_id is distinct from old.folder_id then
    perform pg_advisory_xact_lock(hashtextextended('materials:' || new.company_id::text || ':' || coalesce(new.folder_id::text, ''), 0));
    if exists (select 1 from public.material_folders f
               where f.company_id = new.company_id and f.parent_id is not distinct from new.folder_id
                 and lower(f.name) = lower(new.name)) then
      raise exception 'Folder o tej nazwie jest już w tym miejscu.' using errcode = '23505';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists material_files_guard on public.material_files;
create trigger material_files_guard
  before insert or update on public.material_files
  for each row execute function public.material_files_guard();

-- 6. Wyzwalacze usuwania: ślad + kosz -------------------------------------------------------------------------------------
-- Plik w trakcie wysyłki nie trafia do kosza. Usunięcie całej marki nie tworzy wpisów w koszu.
-- Błąd w wyzwalaczu nie może zablokować usuwania — jest tylko ostrzeżeniem w logach bazy.

create or replace function public.material_files_after_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  begin
    insert into public.material_tombstones (kind, item_id, company_id) values ('file', old.id, old.company_id);
    if old.status = 'ready' and exists (select 1 from public.my_companies c where c.id = old.company_id) then
      insert into public.material_trash
        (kind, item_id, company_id, parent_folder_id, name, storage_path, thumbnail_path, size_bytes, mime_type, snapshot, batch, deleted_by)
      values
        ('file', old.id, old.company_id, old.folder_id, old.name, old.storage_path, old.thumbnail_path, old.size_bytes,
         old.mime_type, to_jsonb(old), txid_current(), public.current_crm_employee_id());
    end if;
  exception when others then
    raise warning 'material_files_after_delete %: %', old.id, sqlerrm;
  end;
  return old;
end $$;

drop trigger if exists material_files_after_delete on public.material_files;
create trigger material_files_after_delete
  after delete on public.material_files
  for each row execute function public.material_files_after_delete();

create or replace function public.material_folders_after_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  begin
    insert into public.material_tombstones (kind, item_id, company_id) values ('folder', old.id, old.company_id);
    if exists (select 1 from public.my_companies c where c.id = old.company_id) then
      insert into public.material_trash (kind, item_id, company_id, parent_folder_id, name, snapshot, batch, deleted_by)
      values ('folder', old.id, old.company_id, old.parent_id, old.name, to_jsonb(old), txid_current(), public.current_crm_employee_id());
    end if;
  exception when others then
    raise warning 'material_folders_after_delete %: %', old.id, sqlerrm;
  end;
  return old;
end $$;

drop trigger if exists material_folders_after_delete on public.material_folders;
create trigger material_folders_after_delete
  after delete on public.material_folders
  for each row execute function public.material_folders_after_delete();

revoke all on function public.material_folders_guard(), public.material_folders_before_delete(), public.material_files_guard(),
  public.material_files_after_delete(), public.material_folders_after_delete() from public, anon, authenticated;

-- 7. RLS ------------------------------------------------------------------------------------------------------------------

alter table public.material_folders enable row level security;
alter table public.material_files enable row level security;
alter table public.material_file_versions enable row level security;
alter table public.material_trash enable row level security;
alter table public.material_tombstones enable row level security;

drop policy if exists material_folders_select on public.material_folders;
create policy material_folders_select on public.material_folders for select to authenticated
  using (public.materials_can(company_id, 'view'));
drop policy if exists material_folders_insert on public.material_folders;
create policy material_folders_insert on public.material_folders for insert to authenticated
  with check (public.materials_can(company_id, 'manage'));
drop policy if exists material_folders_update on public.material_folders;
create policy material_folders_update on public.material_folders for update to authenticated
  using (public.materials_can(company_id, 'manage')) with check (public.materials_can(company_id, 'manage'));
drop policy if exists material_folders_delete on public.material_folders;
create policy material_folders_delete on public.material_folders for delete to authenticated
  using (public.materials_can(company_id, 'manage'));

drop policy if exists material_files_select on public.material_files;
create policy material_files_select on public.material_files for select to authenticated
  using (public.materials_can(company_id, 'view'));
drop policy if exists material_files_insert on public.material_files;
create policy material_files_insert on public.material_files for insert to authenticated
  with check (public.materials_can(company_id, 'manage'));
drop policy if exists material_files_update on public.material_files;
create policy material_files_update on public.material_files for update to authenticated
  using (public.materials_can(company_id, 'manage')) with check (public.materials_can(company_id, 'manage'));
drop policy if exists material_files_delete on public.material_files;
create policy material_files_delete on public.material_files for delete to authenticated
  using (public.materials_can(company_id, 'manage'));

drop policy if exists material_file_versions_select on public.material_file_versions;
create policy material_file_versions_select on public.material_file_versions for select to authenticated
  using (public.materials_can(company_id, 'view'));
drop policy if exists material_file_versions_delete on public.material_file_versions;
create policy material_file_versions_delete on public.material_file_versions for delete to authenticated
  using (public.materials_can(company_id, 'manage'));

drop policy if exists material_trash_select on public.material_trash;
create policy material_trash_select on public.material_trash for select to authenticated
  using (public.materials_can(company_id, 'manage'));
drop policy if exists material_trash_delete on public.material_trash;
create policy material_trash_delete on public.material_trash for delete to authenticated
  using (public.materials_can(company_id, 'manage'));

drop policy if exists material_tombstones_select on public.material_tombstones;
create policy material_tombstones_select on public.material_tombstones for select to authenticated
  using (public.materials_can(company_id, 'view'));

revoke all on public.material_folders, public.material_files, public.material_file_versions, public.material_trash,
  public.material_tombstones from public, anon, authenticated;
grant select, insert, update, delete on public.material_folders, public.material_files to authenticated;
grant select, delete on public.material_file_versions, public.material_trash to authenticated;
grant select on public.material_tombstones to authenticated;
grant all on public.material_folders, public.material_files, public.material_file_versions, public.material_trash,
  public.material_tombstones to service_role;

-- Nazwy marek w wyborze marki („Materiały” bez innych uprawnień).
drop policy if exists "Materials can view assigned companies" on public.my_companies;
create policy "Materials can view assigned companies" on public.my_companies for select to authenticated
  using (public.materials_can(id, 'view'));

-- 8. Funkcje ----------------------------------------------------------------------------------------------------------------

-- Domyślne foldery marki (brakujące). Folder użytkownika o tej samej nazwie w głównym folderze marki staje się domyślnym.
create or replace function public.material_default_folders(p_company uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  d record;
  v_existing uuid;
  v_count integer := 0;
begin
  perform set_config('mavinci.materials_system', 'on', true);
  for d in
    select * from (values
      ('brand', 'Logotypy i księga znaku', 10),
      ('photos', 'Zdjęcia', 20),
      ('video', 'Wideo', 30),
      ('presentations', 'Prezentacje i oferty', 40),
      ('documents', 'Dokumenty', 50),
      ('social', 'Social media', 60)
    ) as v(key, name, sort)
  loop
    continue when exists (select 1 from public.material_folders f where f.company_id = p_company and f.system_key = d.key);
    begin
      select f.id into v_existing from public.material_folders f
      where f.company_id = p_company and f.parent_id is null and f.system_key is null and lower(f.name) = lower(d.name);
      if found then
        update public.material_folders set system_key = d.key, sort_order = d.sort where id = v_existing;
      else
        insert into public.material_folders (company_id, name, system_key, sort_order) values (p_company, d.name, d.key, d.sort);
      end if;
      v_count := v_count + 1;
    exception when others then
      raise warning 'material_default_folders % %: %', p_company, d.key, sqlerrm;
    end;
  end loop;
  perform set_config('mavinci.materials_system', '', true);
  return v_count;
end $$;

revoke all on function public.material_default_folders(uuid) from public, anon, authenticated;
grant execute on function public.material_default_folders(uuid) to service_role;

-- Nowa marka od razu ma domyślne foldery.
create or replace function public.my_companies_material_folders()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  begin
    perform public.material_default_folders(new.id);
  exception when others then
    raise warning 'my_companies_material_folders %: %', new.id, sqlerrm;
  end;
  return null;
end $$;

revoke all on function public.my_companies_material_folders() from public, anon, authenticated;

drop trigger if exists zz_my_companies_material_folders on public.my_companies;
create trigger zz_my_companies_material_folders
  after insert on public.my_companies
  for each row execute function public.my_companies_material_folders();

-- Przywracanie z kosza: tylko wpisy marek, którymi pracownik zarządza. Folder wraca razem ze wszystkim, co usunięto w tej
-- samej operacji (podfoldery najpierw od góry). Brakujący folder nadrzędny → główny folder marki; zajęta nazwa →
-- „Nazwa (przywrócony).pdf”, „Nazwa (przywrócony 2).pdf”…
create or replace function public.restore_material_trash(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  t record;
  v_ids uuid[];
  v_row jsonb;
  v_parent uuid;
  v_name text;
  v_suffix text;
  v_try integer;
  v_restored integer := 0;
  v_skipped integer := 0;
begin
  if public.current_crm_employee_id() is null then
    raise exception 'Wymagane logowanie.' using errcode = '42501';
  end if;

  select array_agg(distinct x.id) into v_ids
  from public.material_trash x
  where public.materials_can(x.company_id, 'manage')
    and (x.id = any(p_ids)
      or exists (select 1 from public.material_trash f
                 where f.id = any(p_ids) and f.kind = 'folder' and f.batch = x.batch and f.company_id = x.company_id));

  if v_ids is null then
    return jsonb_build_object('restored', 0, 'skipped', 0);
  end if;

  for t in
    with recursive tree as (
      select x.id, x.item_id, 0 as depth
      from public.material_trash x
      where x.id = any(v_ids) and x.kind = 'folder'
        and not exists (select 1 from public.material_trash p
                        where p.id = any(v_ids) and p.kind = 'folder' and p.item_id = x.parent_folder_id)
      union all
      select c.id, c.item_id, tree.depth + 1
      from public.material_trash c
      join tree on c.parent_folder_id = tree.item_id
      where c.id = any(v_ids) and c.kind = 'folder' and tree.depth < 60
    ),
    ordered as (
      select tree.id, min(tree.depth) as depth from tree group by tree.id
    )
    select x.*, coalesce(o.depth, case when x.kind = 'folder' then 999 else 1000 end) as restore_order
    from public.material_trash x
    left join ordered o on o.id = x.id
    where x.id = any(v_ids)
    order by restore_order, x.deleted_at
  loop
    if not exists (select 1 from public.my_companies c where c.id = t.company_id) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_row := t.snapshot || jsonb_build_object('updated_at', now());
    v_parent := t.parent_folder_id;
    if v_parent is not null and not exists (select 1 from public.material_folders f where f.id = v_parent and f.company_id = t.company_id) then
      v_parent := null;
    end if;

    if t.kind = 'folder' then
      if exists (select 1 from public.material_folders f where f.id = t.item_id) then
        delete from public.material_trash where id = t.id;
        continue;
      end if;
      v_row := v_row || jsonb_build_object('parent_id', v_parent, 'system_key', null);
    else
      if exists (select 1 from public.material_files f where f.id = t.item_id) then
        delete from public.material_trash where id = t.id;
        continue;
      end if;
      v_row := v_row || jsonb_build_object('folder_id', v_parent);
      if (v_row ->> 'event_id') is not null
         and not exists (select 1 from public.events e where e.id = (v_row ->> 'event_id')::uuid) then
        v_row := v_row || jsonb_build_object('event_id', null);
      end if;
      if (v_row ->> 'created_by') is not null
         and not exists (select 1 from public.employees e where e.id = (v_row ->> 'created_by')::uuid) then
        v_row := v_row || jsonb_build_object('created_by', null);
      end if;
    end if;

    v_name := t.name;
    v_try := 0;
    while v_try < 20 and (
      exists (select 1 from public.material_folders f
              where f.company_id = t.company_id and f.parent_id is not distinct from v_parent and lower(f.name) = lower(v_name))
      or exists (select 1 from public.material_files f
                 where f.company_id = t.company_id and f.folder_id is not distinct from v_parent and lower(f.name) = lower(v_name))
    ) loop
      v_try := v_try + 1;
      v_suffix := ' (przywrócony' || case when v_try > 1 then ' ' || v_try else '' end || ')';
      v_name := case
        when t.kind = 'file' and t.name ~ '.\.[A-Za-z0-9]{1,12}$'
          then regexp_replace(t.name, '(\.[A-Za-z0-9]{1,12})$', v_suffix || '\1')
        else t.name || v_suffix
      end;
    end loop;
    v_row := v_row || jsonb_build_object('name', left(v_name, 255));

    begin
      if t.kind = 'folder' then
        if (v_row ->> 'created_by') is not null
           and not exists (select 1 from public.employees e where e.id = (v_row ->> 'created_by')::uuid) then
          v_row := v_row || jsonb_build_object('created_by', null);
        end if;
        insert into public.material_folders select (jsonb_populate_record(null::public.material_folders, v_row)).*;
      else
        if (v_row ->> 'updated_by') is not null
           and not exists (select 1 from public.employees e where e.id = (v_row ->> 'updated_by')::uuid) then
          v_row := v_row || jsonb_build_object('updated_by', null);
        end if;
        insert into public.material_files select (jsonb_populate_record(null::public.material_files, v_row)).*;
      end if;
    exception when unique_violation then
      raise exception 'Nie udało się przywrócić „%” — ta nazwa jest już zajęta.', t.name using errcode = '23505';
    end;

    delete from public.material_trash where id = t.id;
    v_restored := v_restored + 1;
  end loop;

  return jsonb_build_object('restored', v_restored, 'skipped', v_skipped);
end $$;

revoke all on function public.restore_material_trash(uuid[]) from public, anon;
grant execute on function public.restore_material_trash(uuid[]) to authenticated;

-- Które z podanych obiektów magazynu są nadal w użyciu (plik, miniatura, wpis w koszu, poprzednia wersja) — serwer usuwa
-- z magazynu tylko obiekty nieużywane, niezależnie od tego, które wiersze widzi użytkownik sprzątający kosz.
create or replace function public.material_paths_in_use(p_paths text[])
returns text[]
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(array_agg(distinct p), '{}'::text[])
  from unnest(p_paths) as p
  where public.current_crm_employee_id() is not null
    and (exists (select 1 from public.material_files f where f.storage_path = p or f.thumbnail_path = p)
      or exists (select 1 from public.material_trash t where t.storage_path = p or t.thumbnail_path = p)
      or exists (select 1 from public.material_file_versions v where v.storage_path = p or v.thumbnail_path = p));
$$;

revoke all on function public.material_paths_in_use(text[]) from public, anon;
grant execute on function public.material_paths_in_use(text[]) to authenticated;

-- Ślady usunięć starsze niż 90 dni (Finder przy tak starym punkcie synchronizacji wczytuje wszystko od nowa).
create or replace function public.purge_material_tombstones()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
begin
  if public.current_crm_employee_id() is null then
    raise exception 'Wymagane logowanie.' using errcode = '42501';
  end if;
  delete from public.material_tombstones where deleted_at < now() - interval '90 days';
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.purge_material_tombstones() from public, anon;
grant execute on function public.purge_material_tombstones() to authenticated;

-- Wyszukiwanie w Materiałach (RLS wywołującego): każde słowo musi wystąpić w nazwie, opisie albo tagach.
create or replace function public.materials_search(p_query text, p_company uuid default null, p_limit integer default 100)
returns setof public.material_files
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with q as (
    select array(
      select t from regexp_split_to_table(lower(btrim(coalesce(p_query, ''))), '\s+') as t where t <> '' limit 8
    ) as tokens
  )
  select f.*
  from public.material_files f, q
  where cardinality(q.tokens) > 0
    and f.status = 'ready'
    and (p_company is null or f.company_id = p_company)
    and not exists (
      select 1 from unnest(q.tokens) as t
      where position(t in lower(f.name || ' ' || f.description || ' ' || array_to_string(f.tags, ' '))) = 0
    )
  order by f.updated_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

revoke all on function public.materials_search(text, uuid, integer) from public, anon;
grant execute on function public.materials_search(text, uuid, integer) to authenticated;

-- Pliki wydarzeń w wyszukiwaniu Materiałów (RLS wywołującego — tylko wydarzenia i pliki, które pracownik widzi w CRM):
-- każde słowo w nazwie pliku, nazwie wydarzenia albo folderu.
create or replace function public.materials_search_event_files(p_query text, p_limit integer default 60)
returns table (
  id uuid, event_id uuid, folder_id uuid, name text, file_path text, file_size bigint, mime_type text, created_at timestamptz,
  event_name text, event_date timestamptz, folder_name text
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with q as (
    select array(
      select t from regexp_split_to_table(lower(btrim(coalesce(p_query, ''))), '\s+') as t where t <> '' limit 8
    ) as tokens
  )
  select f.id, f.event_id, f.folder_id, coalesce(nullif(f.name, ''), f.original_name), f.file_path, f.file_size, f.mime_type,
         f.created_at, e.name, e.event_date, fo.name
  from public.event_files f
  join public.events e on e.id = f.event_id
  left join public.event_folders fo on fo.id = f.folder_id
  cross join q
  where cardinality(q.tokens) > 0
    and coalesce(f.file_path, '') <> ''
    and not exists (
      select 1 from unnest(q.tokens) as t
      where position(t in lower(coalesce(nullif(f.name, ''), f.original_name, '') || ' ' || coalesce(e.name, '') || ' '
                                || coalesce(fo.name, ''))) = 0
    )
  order by e.event_date desc nulls last, f.created_at desc
  limit least(greatest(coalesce(p_limit, 60), 1), 120);
$$;

revoke all on function public.materials_search_event_files(text, integer) from public, anon;
grant execute on function public.materials_search_event_files(text, integer) to authenticated;

-- 9. Magazyn: prywatny bucket `materials` ----------------------------------------------------------------------------------
-- `<marka>/<plik>/<nazwa>` — odczyt: podgląd marki — aktualna treść, miniatura i poprzednie wersje gotowego pliku,
-- zarządzanie — wszystkie obiekty pliku (także w koszu); zapis: zarządzanie i wpis pliku już istnieje (najpierw
-- `prepareUpload`); usuwanie: zarządzanie (serwer usuwa tylko obiekty nieużywane). Obiekty nie są nadpisywane (nowa nazwa przy każdej zmianie treści) — bez prawa UPDATE.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('materials', 'materials', false, 2147483648, null)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = null;

create or replace function public.materials_storage_can(p_name text, p_mode text)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_parts text[] := string_to_array(coalesce(p_name, ''), '/');
  v_company uuid;
  v_file uuid;
begin
  if public.current_crm_employee_id() is null or public.current_session_is_seller_portal() or cardinality(v_parts) <> 3
    or v_parts[1] !~ '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
    or v_parts[2] !~ '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
    or v_parts[3] !~ '^[A-Za-z0-9._-]{1,80}$' then
    return false;
  end if;
  v_company := v_parts[1]::uuid;
  v_file := v_parts[2]::uuid;
  if p_mode = 'read' then
    -- Zarządzający: każdy obiekt pliku (także nowa treść przed zatwierdzeniem, plik w koszu i poprzednie wersje).
    -- Podgląd: tylko aktualna treść, miniatura i poprzednie wersje istniejącego pliku.
    return (public.materials_can(v_company, 'manage')
        and (exists (select 1 from public.material_files f where f.id = v_file and f.company_id = v_company)
          or exists (select 1 from public.material_trash t where t.kind = 'file' and t.item_id = v_file and t.company_id = v_company)
          or exists (select 1 from public.material_file_versions v where v.file_id = v_file and v.company_id = v_company)))
      or (public.materials_can(v_company, 'view')
        and exists (select 1 from public.material_files f
                    where f.id = v_file and f.company_id = v_company and f.status = 'ready'
                      and (f.storage_path = p_name or f.thumbnail_path = p_name
                        or exists (select 1 from public.material_file_versions v
                                   where v.file_id = f.id and (v.storage_path = p_name or v.thumbnail_path = p_name)))));
  elsif p_mode = 'write' then
    return public.materials_can(v_company, 'manage')
      and exists (select 1 from public.material_files f where f.id = v_file and f.company_id = v_company);
  elsif p_mode = 'delete' then
    return public.materials_can(v_company, 'manage');
  end if;
  return false;
end $$;

revoke all on function public.materials_storage_can(text, text) from public, anon;
grant execute on function public.materials_storage_can(text, text) to authenticated, service_role;

drop policy if exists "Materials read" on storage.objects;
create policy "Materials read" on storage.objects for select to authenticated
  using (bucket_id = 'materials' and public.materials_storage_can(name, 'read'));
drop policy if exists "Materials insert" on storage.objects;
create policy "Materials insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'materials' and public.materials_storage_can(name, 'write'));
drop policy if exists "Materials delete" on storage.objects;
create policy "Materials delete" on storage.objects for delete to authenticated
  using (bucket_id = 'materials' and public.materials_storage_can(name, 'delete'));

-- 10. Uprawnienia sekcji „Materiały” w „Dostępie według sekcji” (moduł `materials`). Treść funkcji bez zmian poza listą
-- znanych zakresów: + materials_view, materials_manage.

CREATE OR REPLACE FUNCTION public.admin_set_employee_section_permissions(p_employee_id uuid, p_module text, p_permissions text[], p_expected_permissions text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_employee public.employees%ROWTYPE; v_current text[]; v_expected text[]; v_next text[];
 v_known constant text[] := ARRAY['events_view','events_view_planning','events_view_operational','events_manage','events_create','event_categories_manage','calendar_view','calendar_manage','calendar_view_accepted_only','tasks_view','tasks_manage','tasks_create','offers_view','offers_manage','offers_create','offers_brochures_view_own','offers_brochures_view_all','contracts_view','contracts_manage','contracts_create','contracts_own_only','offers_own_only','events_own_only','attractions_view','attractions_manage','attractions_create','clients_view','clients_manage','clients_create','contacts_view','contacts_manage','contacts_create','inquiries_view','inquiries_manage','inquiries_view_pool','inquiries_view_own','inquiries_manage_own','inquiries_view_team','inquiries_manage_team','inquiries_view_all','inquiries_manage_all','inquiries_assign','messages_view','messages_manage','messages_assign','marketing_campaigns_view','marketing_campaigns_manage','marketing_campaigns_approve','marketing_social_view','marketing_social_create','marketing_social_approve','marketing_social_publish','materials_view','materials_manage','chat_view','chat_manage','chat_create_group','webhooks_view','webhooks_manage','equipment_view','equipment_manage','equipment_create','fleet_view','fleet_manage','fleet_create','locations_view','locations_manage','locations_create','subcontractors_manage','time_tracking_view_own','time_tracking_view','time_tracking_manage','mavinci_live_view','mavinci_live_manage','mavinci_live_light_magic','mavinci_live_quiz_show','mavinci_live_familiada','mavinci_live_wedding_show','mavinci_live_streaming','finances_view','finances_manage','invoices_view','invoices_manage','databases_view','databases_manage','tenders_view','personnel_view','personnel_manage','employees_view','employees_manage','employees_create','employees_permissions','page_view','page_manage','website_edit'];
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.employees e WHERE (e.id=auth.uid() OR e.auth_user_id=auth.uid()) AND e.is_active AND (e.role='admin' OR e.access_level='admin')) THEN
  RAISE EXCEPTION 'Tylko administrator może zmieniać dostęp w ustawieniach aplikacji.' USING ERRCODE='42501';
 END IF;
 IF p_module IS NULL OR p_module !~ '^[a-z_]+$' OR NOT EXISTS(SELECT 1 FROM unnest(v_known) s WHERE starts_with(s,p_module||'_')) THEN
  RAISE EXCEPTION 'Nieznana sekcja.' USING ERRCODE='22023';
 END IF;
 IF p_permissions IS NULL OR p_expected_permissions IS NULL OR EXISTS(SELECT 1 FROM unnest(p_permissions) s WHERE s IS NULL OR NOT (s=ANY(v_known)) OR NOT starts_with(s,p_module||'_')) THEN
  RAISE EXCEPTION 'Nieprawidłowy zakres dla sekcji.' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_employee FROM public.employees WHERE id=p_employee_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono pracownika.'; END IF;
 IF v_employee.role='admin' OR v_employee.access_level='admin' THEN RAISE EXCEPTION 'Administrator zachowuje pełny dostęp.' USING ERRCODE='42501'; END IF;
 SELECT coalesce(array_agg(DISTINCT s ORDER BY s),'{}') INTO v_current FROM unnest(coalesce(v_employee.permissions,'{}')) s WHERE starts_with(s,p_module||'_');
 SELECT coalesce(array_agg(DISTINCT s ORDER BY s),'{}') INTO v_expected FROM unnest(p_expected_permissions) s;
 IF v_current IS DISTINCT FROM v_expected THEN RAISE EXCEPTION 'Uprawnienia tej sekcji zmieniono w innym oknie. Otwórz edycję ponownie.' USING ERRCODE='40001'; END IF;
 SELECT coalesce(array_agg(DISTINCT s ORDER BY s),'{}') INTO v_next FROM (
 SELECT s FROM unnest(coalesce(v_employee.permissions,'{}')) s WHERE NOT starts_with(s,p_module||'_')
 UNION SELECT unnest(p_permissions)) scope;
 UPDATE public.employees SET permissions=v_next,role_permissions_inherited=false,updated_at=clock_timestamp() WHERE id=p_employee_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_employee_section_permissions(uuid,text,text[],text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_employee_section_permissions(uuid,text,text[],text[]) TO authenticated;

-- 11. Domyślne foldery istniejących marek -------------------------------------------------------------------------------

do $$
declare
  c record;
begin
  for c in select id from public.my_companies loop
    perform public.material_default_folders(c.id);
  end loop;
end $$;

-- 12. Realtime: lista w CRM odświeża się po zmianach innych osób (RLS jak przy odczycie) ----------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'material_files') then
      alter publication supabase_realtime add table public.material_files;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'material_folders') then
      alter publication supabase_realtime add table public.material_folders;
    end if;
  end if;
end $$;

commit;
