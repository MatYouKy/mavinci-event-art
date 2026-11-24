-- Materiały → „Udostępnij link”: folder, album albo wybrane pliki do pobrania przez osobę spoza firmy (np. zdjęcia z fotobudki).
--
-- • `material_share_links` — link marki: losowy token w adresie `/pobierz/<token>`, tytuł i wiadomość na stronie, ważność
--   (`expires_at`), wyłączenie (`revoked_at`), dostęp: każdy z linkiem (`public`) albo po podaniu e-maila z listy i hasła
--   (`password`; hasło jako skrót scrypt liczony na serwerze — bazy nie da się odczytać do hasła). Liczniki otwarć i pobrań.
-- • `material_share_link_items` — co jest w linku: folder (z podfolderami, „na żywo” — także pliki dodane później), album
--   albo plik. Tylko elementy tej samej marki.
-- • `material_share_sessions` — otwarcie linku z hasłem (skrót losowego klucza z ciasteczka przeglądarki odbiorcy, e-mail),
--   `material_share_attempts` — próby hasła (ograniczenie zgadywania; skrót adresu IP, bez samego adresu).
-- • Uprawnienia: linki tworzy, zmienia i usuwa „Materiały — zarządzanie” marki (`materials_can(…, 'manage')`, administrator);
--   sesje i próby — wyłącznie serwer (klucz serwisowy, strona `/pobierz`). Liczniki — `material_share_touch` (serwer).
-- Plik idempotentny — można go wykonać ponownie.

begin;

-- 1. Linki ---------------------------------------------------------------------------------------------------------------------

create table if not exists public.material_share_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.my_companies(id) on delete cascade,
  token text not null,
  title text not null,
  message text not null default '',
  access_mode text not null default 'public',
  allowed_emails text[] not null default '{}',
  password_hash text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  view_count integer not null default 0,
  download_count integer not null default 0,
  last_viewed_at timestamptz,
  last_downloaded_at timestamptz,
  created_by uuid references public.employees(id) on delete set null,
  updated_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint material_share_links_token_check check (token ~ '^[A-Za-z0-9_-]{32,64}$'),
  constraint material_share_links_title_check check (char_length(btrim(title)) between 1 and 120),
  constraint material_share_links_message_check check (char_length(message) <= 2000),
  constraint material_share_links_access_check check (access_mode in ('public', 'password')),
  constraint material_share_links_password_check check (
    access_mode = 'public'
    or (password_hash is not null and cardinality(allowed_emails) between 1 and 10)
  ),
  constraint material_share_links_expiry_check check (expires_at > created_at)
);

create unique index if not exists material_share_links_token_key on public.material_share_links (token);
create index if not exists material_share_links_company_idx on public.material_share_links (company_id, created_at desc);

create table if not exists public.material_share_link_items (
  link_id uuid not null references public.material_share_links(id) on delete cascade,
  kind text not null,
  item_id uuid not null,
  company_id uuid not null references public.my_companies(id) on delete cascade,
  sort_order integer not null default 0,
  primary key (link_id, kind, item_id),
  constraint material_share_link_items_kind_check check (kind in ('folder', 'file', 'album'))
);

create index if not exists material_share_link_items_item_idx on public.material_share_link_items (item_id);

-- Link: autor, data zmiany (tylko zmiany pracownika — liczniki serwera jej nie przesuwają); marki, tokenu i autora nie zmienia się.
create or replace function public.material_share_links_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_employee uuid := public.current_crm_employee_id();
begin
  new.title := btrim(new.title);
  new.message := coalesce(new.message, '');
  new.allowed_emails := coalesce(new.allowed_emails, '{}'::text[]);
  if tg_op = 'INSERT' then
    new.created_by := coalesce(v_employee, new.created_by);
    new.created_at := now();
    new.updated_at := now();
    new.view_count := 0;
    new.download_count := 0;
    new.last_viewed_at := null;
    new.last_downloaded_at := null;
  else
    if new.company_id is distinct from old.company_id or new.token is distinct from old.token then
      raise exception 'Linku nie można przenieść do innej marki ani zmienić jego adresu.' using errcode = '22023';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if v_employee is not null then
      new.updated_by := v_employee;
      new.updated_at := now();
      -- Liczniki zmienia tylko serwer strony pobierania.
      new.view_count := old.view_count;
      new.download_count := old.download_count;
      new.last_viewed_at := old.last_viewed_at;
      new.last_downloaded_at := old.last_downloaded_at;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists material_share_links_guard on public.material_share_links;
create trigger material_share_links_guard
  before insert or update on public.material_share_links
  for each row execute function public.material_share_links_guard();

-- Element linku: marka z linku; folder, album albo gotowy plik tej samej marki.
create or replace function public.material_share_link_items_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_company uuid;
begin
  select l.company_id into v_company from public.material_share_links l where l.id = new.link_id;
  if v_company is null then
    raise exception 'Nie znaleziono linku.' using errcode = 'P0002';
  end if;
  if tg_op = 'UPDATE' and (new.link_id is distinct from old.link_id or new.kind is distinct from old.kind or new.item_id is distinct from old.item_id) then
    raise exception 'Elementu linku nie można przepiąć — utwórz nowy link.' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' and not (
    (new.kind = 'folder' and exists (select 1 from public.material_folders f where f.id = new.item_id and f.company_id = v_company))
    or (new.kind = 'album' and exists (select 1 from public.material_albums a where a.id = new.item_id and a.company_id = v_company))
    or (new.kind = 'file' and exists (select 1 from public.material_files f where f.id = new.item_id and f.company_id = v_company and f.status = 'ready'))
  ) then
    raise exception 'Do linku można dodać tylko foldery, albumy i gotowe pliki tej samej marki.' using errcode = '22023';
  end if;
  new.company_id := v_company;
  return new;
end $$;

drop trigger if exists material_share_link_items_guard on public.material_share_link_items;
create trigger material_share_link_items_guard
  before insert or update on public.material_share_link_items
  for each row execute function public.material_share_link_items_guard();

-- 2. Otwarcia linków z hasłem i próby hasła (tylko serwer) ---------------------------------------------------------------------

create table if not exists public.material_share_sessions (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.material_share_links(id) on delete cascade,
  session_hash text not null,
  email text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz
);

create unique index if not exists material_share_sessions_hash_key on public.material_share_sessions (session_hash);
create index if not exists material_share_sessions_link_idx on public.material_share_sessions (link_id, created_at desc);

create table if not exists public.material_share_attempts (
  id bigint generated always as identity primary key,
  link_id uuid not null references public.material_share_links(id) on delete cascade,
  client_hash text not null,
  succeeded boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists material_share_attempts_link_idx on public.material_share_attempts (link_id, created_at desc);

-- 3. Liczniki (serwer strony pobierania) ----------------------------------------------------------------------------------------

create or replace function public.material_share_touch(p_link uuid, p_kind text)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  update public.material_share_links l
  set view_count = l.view_count + case when p_kind = 'view' then 1 else 0 end,
      last_viewed_at = case when p_kind = 'view' then now() else l.last_viewed_at end,
      download_count = l.download_count + case when p_kind = 'download' then 1 else 0 end,
      last_downloaded_at = case when p_kind = 'download' then now() else l.last_downloaded_at end
  where l.id = p_link;
$$;

revoke all on function public.material_share_touch(uuid, text) from public, anon, authenticated;
grant execute on function public.material_share_touch(uuid, text) to service_role;

-- 4. RLS -----------------------------------------------------------------------------------------------------------------------

alter table public.material_share_links enable row level security;
alter table public.material_share_link_items enable row level security;
alter table public.material_share_sessions enable row level security;
alter table public.material_share_attempts enable row level security;

drop policy if exists material_share_links_select on public.material_share_links;
create policy material_share_links_select on public.material_share_links for select to authenticated
  using (public.materials_can(company_id, 'manage'));
drop policy if exists material_share_links_insert on public.material_share_links;
create policy material_share_links_insert on public.material_share_links for insert to authenticated
  with check (public.materials_can(company_id, 'manage'));
drop policy if exists material_share_links_update on public.material_share_links;
create policy material_share_links_update on public.material_share_links for update to authenticated
  using (public.materials_can(company_id, 'manage')) with check (public.materials_can(company_id, 'manage'));
drop policy if exists material_share_links_delete on public.material_share_links;
create policy material_share_links_delete on public.material_share_links for delete to authenticated
  using (public.materials_can(company_id, 'manage'));

drop policy if exists material_share_link_items_select on public.material_share_link_items;
create policy material_share_link_items_select on public.material_share_link_items for select to authenticated
  using (public.materials_can(company_id, 'manage'));
drop policy if exists material_share_link_items_insert on public.material_share_link_items;
create policy material_share_link_items_insert on public.material_share_link_items for insert to authenticated
  with check (exists (select 1 from public.material_share_links l where l.id = link_id and public.materials_can(l.company_id, 'manage')));
drop policy if exists material_share_link_items_delete on public.material_share_link_items;
create policy material_share_link_items_delete on public.material_share_link_items for delete to authenticated
  using (public.materials_can(company_id, 'manage'));

revoke all on public.material_share_links, public.material_share_link_items from public, anon, authenticated;
grant select, insert, update, delete on public.material_share_links to authenticated;
grant select, insert, delete on public.material_share_link_items to authenticated;
grant all on public.material_share_links, public.material_share_link_items to service_role;

revoke all on public.material_share_sessions, public.material_share_attempts from public, anon, authenticated;
grant all on public.material_share_sessions, public.material_share_attempts to service_role;
grant usage, select on sequence public.material_share_attempts_id_seq to service_role;

commit;
