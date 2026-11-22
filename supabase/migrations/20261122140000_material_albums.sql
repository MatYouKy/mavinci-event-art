-- Materiały → albumy (główna baza zdjęć) i zdjęcia z Materiałów w Prezentacjach (Strefa sprzedawcy).
--
-- • `material_albums` — album marki (nazwa, opis, okładka, kolejność). Album nie kopiuje plików: `material_album_items` to
--   odnośniki do plików Materiałów tej samej marki (ten sam plik może być w wielu albumach). Usunięcie albumu nie usuwa
--   plików. Plik w koszu znika z albumów do czasu przywrócenia (odnośnik zostaje); usunięty na zawsze — odnośniki znikają.
-- • Uprawnienia jak w Materiałach (`materials_can`): podgląd — „Materiały — podgląd”, zmiany — „Materiały — zarządzanie”,
--   z zakresem marek; sprzedawca z portalu — nic.
-- • Prezentacje: zdjęcie z Materiałów jest w karcie odnośnikiem do pliku, a do pokazu na iPadzie serwer przygotowuje jedną
--   wersję WebP na wersję treści pliku (`sales-showcase/materials/<plik>/v<wersja>.webp` + miniatura `-t.webp`) — wspólną
--   dla wszystkich kart i okładek (bez duplikatów).
-- Plik idempotentny — można go wykonać ponownie.

begin;

-- 1. Albumy -----------------------------------------------------------------------------------------------------------------

create table if not exists public.material_albums (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.my_companies(id) on delete cascade,
  name text not null,
  description text not null default '',
  cover_file_id uuid,
  sort_order integer not null default 0,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint material_albums_name_check check (char_length(btrim(name)) between 1 and 120),
  constraint material_albums_description_check check (char_length(description) <= 1000)
);

create unique index if not exists material_albums_company_name_key on public.material_albums (company_id, lower(btrim(name)));
create index if not exists material_albums_company_order_idx on public.material_albums (company_id, sort_order);

create table if not exists public.material_album_items (
  album_id uuid not null references public.material_albums(id) on delete cascade,
  file_id uuid not null,
  company_id uuid not null references public.my_companies(id) on delete cascade,
  sort_order integer not null default 0,
  added_by uuid references public.employees(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (album_id, file_id)
);

create index if not exists material_album_items_file_idx on public.material_album_items (file_id);
create index if not exists material_album_items_order_idx on public.material_album_items (album_id, sort_order);

-- Album: data zmiany, autor; nazwa bez spacji na brzegach.
create or replace function public.material_albums_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  new.name := btrim(new.name);
  new.description := coalesce(new.description, '');
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, public.current_crm_employee_id());
    new.created_at := now();
  else
    if new.company_id is distinct from old.company_id then
      raise exception 'Albumu nie można przenieść do innej marki.' using errcode = '22023';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists material_albums_guard on public.material_albums;
create trigger material_albums_guard
  before insert or update on public.material_albums
  for each row execute function public.material_albums_guard();

-- Odnośnik: marka z albumu, tylko gotowy plik tej samej marki.
create or replace function public.material_album_items_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_company uuid;
begin
  select a.company_id into v_company from public.material_albums a where a.id = new.album_id;
  if v_company is null then
    raise exception 'Nie znaleziono albumu.' using errcode = 'P0002';
  end if;
  if tg_op = 'UPDATE' and (new.album_id is distinct from old.album_id or new.file_id is distinct from old.file_id) then
    raise exception 'Odnośnika w albumie nie można przepiąć — dodaj plik ponownie.' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.material_files f where f.id = new.file_id and f.company_id = v_company and f.status = 'ready') then
      raise exception 'Do albumu można dodać tylko gotowy plik tej samej marki.' using errcode = '22023';
    end if;
    new.added_by := coalesce(new.added_by, public.current_crm_employee_id());
    new.added_at := now();
  end if;
  new.company_id := v_company;
  return new;
end $$;

drop trigger if exists material_album_items_guard on public.material_album_items;
create trigger material_album_items_guard
  before insert or update on public.material_album_items
  for each row execute function public.material_album_items_guard();

-- Plik usunięty na zawsze (wpis kosza znika, a pliku nie przywrócono) — odnośniki w albumach znikają.
-- Przywrócenie z kosza wstawia plik przed usunięciem wpisu, więc odnośniki zostają.
create or replace function public.material_trash_album_cleanup()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  begin
    if old.kind = 'file' and not exists (select 1 from public.material_files f where f.id = old.item_id) then
      delete from public.material_album_items i where i.file_id = old.item_id;
      update public.material_albums a set cover_file_id = null where a.cover_file_id = old.item_id;
    end if;
  exception when others then
    raise warning 'material_trash_album_cleanup %: %', old.item_id, sqlerrm;
  end;
  return old;
end $$;

drop trigger if exists material_trash_album_cleanup on public.material_trash;
create trigger material_trash_album_cleanup
  after delete on public.material_trash
  for each row execute function public.material_trash_album_cleanup();

-- 2. Kolejność (przeciąganie) -------------------------------------------------------------------------------------------------

-- Kolejność plików w albumie: podane pliki w tej kolejności, pozostałe za nimi (bez zmian względem siebie).
create or replace function public.material_album_reorder(p_album uuid, p_files uuid[])
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_company uuid;
begin
  select a.company_id into v_company from public.material_albums a where a.id = p_album;
  if v_company is null then
    raise exception 'Nie znaleziono albumu.' using errcode = 'P0002';
  end if;
  if not public.materials_can(v_company, 'manage') then
    raise exception 'Nie masz uprawnień do zmian w Materiałach tej marki.' using errcode = '42501';
  end if;
  update public.material_album_items i
  set sort_order = x.position
  from (
    select coalesce(array_position(p_files, i2.file_id), cardinality(coalesce(p_files, '{}'::uuid[])) + row_number() over (order by i2.sort_order, i2.added_at)) as position,
           i2.file_id
    from public.material_album_items i2
    where i2.album_id = p_album
  ) x
  where i.album_id = p_album and i.file_id = x.file_id;
end $$;

revoke all on function public.material_album_reorder(uuid, uuid[]) from public, anon;
grant execute on function public.material_album_reorder(uuid, uuid[]) to authenticated, service_role;

-- Kolejność albumów marki: podane w tej kolejności, pozostałe za nimi.
create or replace function public.material_albums_reorder(p_company uuid, p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if not public.materials_can(p_company, 'manage') then
    raise exception 'Nie masz uprawnień do zmian w Materiałach tej marki.' using errcode = '42501';
  end if;
  update public.material_albums a
  set sort_order = x.position
  from (
    select coalesce(array_position(p_ids, a2.id), cardinality(coalesce(p_ids, '{}'::uuid[])) + row_number() over (order by a2.sort_order, a2.name)) as position,
           a2.id
    from public.material_albums a2
    where a2.company_id = p_company
  ) x
  where a.id = x.id and a.company_id = p_company;
end $$;

revoke all on function public.material_albums_reorder(uuid, uuid[]) from public, anon;
grant execute on function public.material_albums_reorder(uuid, uuid[]) to authenticated, service_role;

-- 3. RLS ----------------------------------------------------------------------------------------------------------------------

alter table public.material_albums enable row level security;
alter table public.material_album_items enable row level security;

drop policy if exists material_albums_select on public.material_albums;
create policy material_albums_select on public.material_albums for select to authenticated
  using (public.materials_can(company_id, 'view'));
drop policy if exists material_albums_insert on public.material_albums;
create policy material_albums_insert on public.material_albums for insert to authenticated
  with check (public.materials_can(company_id, 'manage'));
drop policy if exists material_albums_update on public.material_albums;
create policy material_albums_update on public.material_albums for update to authenticated
  using (public.materials_can(company_id, 'manage')) with check (public.materials_can(company_id, 'manage'));
drop policy if exists material_albums_delete on public.material_albums;
create policy material_albums_delete on public.material_albums for delete to authenticated
  using (public.materials_can(company_id, 'manage'));

drop policy if exists material_album_items_select on public.material_album_items;
create policy material_album_items_select on public.material_album_items for select to authenticated
  using (public.materials_can(company_id, 'view'));
drop policy if exists material_album_items_insert on public.material_album_items;
create policy material_album_items_insert on public.material_album_items for insert to authenticated
  with check (exists (select 1 from public.material_albums a where a.id = album_id and public.materials_can(a.company_id, 'manage')));
drop policy if exists material_album_items_update on public.material_album_items;
create policy material_album_items_update on public.material_album_items for update to authenticated
  using (public.materials_can(company_id, 'manage')) with check (public.materials_can(company_id, 'manage'));
drop policy if exists material_album_items_delete on public.material_album_items;
create policy material_album_items_delete on public.material_album_items for delete to authenticated
  using (public.materials_can(company_id, 'manage'));

revoke all on public.material_albums, public.material_album_items from public, anon, authenticated;
grant select, insert, update, delete on public.material_albums, public.material_album_items to authenticated;
grant all on public.material_albums, public.material_album_items to service_role;

-- 4. Prezentacje: wersje WebP zdjęć z Materiałów w buckecie `sales-showcase` ----------------------------------------------------

drop policy if exists "Sales showcase insert" on storage.objects;
create policy "Sales showcase insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'sales-showcase' and public.sales_showcase_can('manage')
    and (
      name ~ '^(items|sections)/[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}/[A-Za-z0-9._-]{1,100}$'
      or name ~ '^materials/[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}/v[0-9]{1,9}(-t)?\.webp$'
    )
  );

commit;
