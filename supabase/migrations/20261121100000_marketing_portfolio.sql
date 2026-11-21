-- Marketing → „Realizacje”: kopie robocze realizacji portfolio strony mavinci.pl (web CRM, Mac, telefon).
-- Plik idempotentny — można go wykonać ponownie.
--
-- Realizację przygotowuje się w kopii roboczej (`marketing_portfolio_items.content` — tytuł, adres, opisy, SEO, zdjęcia,
-- elementy realizacji, miasta), a „Opublikuj” przepisuje ją do `portfolio_projects` (strona czyta tylko tę tabelę, więc szkice
-- nigdy nie trafiają na stronę ani do map witryny). Opublikowaną realizację można dalej poprawiać i publikować zmiany.
-- `published_hash` — skrót treści opublikowanej (liczy serwer Next): różnica względem strony oznacza zmianę zrobioną
-- bezpośrednio na stronie (tryb edycji) — serwer pobiera ją do kopii roboczej albo zgłasza konflikt.
-- Dostęp jak do edycji strony: administrator albo uprawnienie `website_edit` / `page_manage` (`can_edit_website()`).
-- Istniejące realizacje dostają kopie robocze przy pierwszym otwarciu „Realizacji” (serwer — ta sama funkcja co publikacja).

create table if not exists public.marketing_portfolio_items (
  id uuid primary key default gen_random_uuid(),
  portfolio_project_id uuid references public.portfolio_projects(id) on delete set null,
  event_id uuid references public.events(id) on delete set null,
  company_id uuid references public.my_companies(id) on delete set null,
  content jsonb not null default '{}'::jsonb,
  title text generated always as (left(coalesce(content ->> 'title', ''), 200)) stored,
  slug text generated always as (nullif(content ->> 'slug', '')) stored,
  version integer not null default 1,
  published_hash text,
  published_at timestamptz,
  published_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references public.employees(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.employees(id) on delete set null,
  constraint marketing_portfolio_items_content_check check (jsonb_typeof(content) = 'object' and pg_column_size(content) <= 400000),
  constraint marketing_portfolio_items_version_check check (version >= 1),
  constraint marketing_portfolio_items_hash_check check (published_hash is null or published_hash ~ '^[0-9a-f]{64}$')
);

create unique index if not exists marketing_portfolio_items_project_idx
  on public.marketing_portfolio_items (portfolio_project_id) where portfolio_project_id is not null;
create unique index if not exists marketing_portfolio_items_slug_idx
  on public.marketing_portfolio_items (slug) where slug is not null;
create index if not exists marketing_portfolio_items_event_idx on public.marketing_portfolio_items (event_id) where event_id is not null;

comment on table public.marketing_portfolio_items is
  'Marketing → Realizacje: kopie robocze realizacji portfolio strony; publikacja przepisuje treść do portfolio_projects.';

-- Autor, wersja i pola publikacji. Pola publikacji (`portfolio_project_id`, `published_*`) zmieniają wyłącznie funkcje
-- poniżej (`mavinci.portfolio_publish`) i usunięcie realizacji ze strony (ON DELETE SET NULL).
create or replace function public.marketing_portfolio_items_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := public.current_crm_employee_id();
  v_publish boolean := coalesce(current_setting('mavinci.portfolio_publish', true), '') = 'on';
  v_direct boolean := pg_trigger_depth() = 1 and auth.uid() is not null;
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.created_at := now();
    new.updated_at := now();
    new.created_by := coalesce(v_actor, new.created_by);
    new.updated_by := coalesce(v_actor, new.updated_by);
    if not v_publish then
      new.portfolio_project_id := null;
      new.published_hash := null;
      new.published_at := null;
      new.published_by := null;
    end if;
    return new;
  end if;

  new.created_at := old.created_at;
  new.created_by := case when new.created_by is null then null else old.created_by end;
  if v_direct and not v_publish then
    new.portfolio_project_id := old.portfolio_project_id;
    new.published_hash := old.published_hash;
    new.published_at := old.published_at;
    new.published_by := case when new.published_by is null then null else old.published_by end;
  end if;
  if new.content is distinct from old.content or new.event_id is distinct from old.event_id or new.company_id is distinct from old.company_id then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  -- Kolumny wyliczane (`title`, `slug`) mają w wyzwalaczu BEFORE jeszcze starą wartość — porównujemy bez nich.
  if (to_jsonb(new) - array['updated_at', 'updated_by', 'title', 'slug'])
     is distinct from (to_jsonb(old) - array['updated_at', 'updated_by', 'title', 'slug']) then
    new.updated_at := now();
    if v_direct then new.updated_by := coalesce(v_actor, old.updated_by); end if;
  else
    new.updated_at := old.updated_at;
    new.updated_by := old.updated_by;
  end if;
  return new;
end;
$$;

drop trigger if exists marketing_portfolio_items_guard on public.marketing_portfolio_items;
create trigger marketing_portfolio_items_guard before insert or update on public.marketing_portfolio_items
  for each row execute function public.marketing_portfolio_items_guard();

alter table public.marketing_portfolio_items enable row level security;

drop policy if exists marketing_portfolio_items_select on public.marketing_portfolio_items;
create policy marketing_portfolio_items_select on public.marketing_portfolio_items for select to authenticated
  using (public.can_edit_website());
drop policy if exists marketing_portfolio_items_insert on public.marketing_portfolio_items;
create policy marketing_portfolio_items_insert on public.marketing_portfolio_items for insert to authenticated
  with check (public.can_edit_website());
drop policy if exists marketing_portfolio_items_update on public.marketing_portfolio_items;
create policy marketing_portfolio_items_update on public.marketing_portfolio_items for update to authenticated
  using (public.can_edit_website()) with check (public.can_edit_website());
drop policy if exists marketing_portfolio_items_delete on public.marketing_portfolio_items;
create policy marketing_portfolio_items_delete on public.marketing_portfolio_items for delete to authenticated
  using (public.can_edit_website());

revoke all on public.marketing_portfolio_items from public, anon;
grant select, insert, update, delete on public.marketing_portfolio_items to authenticated;
grant all on public.marketing_portfolio_items to service_role;

-- Kolumny strony z treści przygotowanej przez serwer (`p_site`: nazwy jak w `portfolio_projects`).
create or replace function public.portfolio_item_publish(p_id uuid, p_version integer, p_site jsonb, p_hash text)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_item public.marketing_portfolio_items%rowtype;
  v_project uuid;
  v_current_slug text;
  v_slug text := p_site ->> 'slug';
begin
  if not public.can_edit_website() then
    raise exception 'Publikować realizacje może osoba z uprawnieniem do edycji strony.' using errcode = '42501';
  end if;
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_site) <> 'object' then
    raise exception 'Nieprawidłowe dane publikacji.' using errcode = '22023';
  end if;
  if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_slug) > 90 then
    raise exception 'Nieprawidłowy adres realizacji.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_site ->> 'title', ''))) = 0 then
    raise exception 'Realizacja musi mieć tytuł.' using errcode = '22023';
  end if;
  select * into v_item from public.marketing_portfolio_items where id = p_id for update;
  if not found then
    raise exception 'Nie znaleziono realizacji.' using errcode = 'P0002';
  end if;
  if v_item.version <> p_version then
    raise exception 'Realizację zmieniono w innym oknie. Odśwież widok — publikacja nie została wykonana.' using errcode = '40001';
  end if;

  if v_item.portfolio_project_id is not null then
    select slug into v_current_slug from public.portfolio_projects where id = v_item.portfolio_project_id for update;
    if found then
      v_project := v_item.portfolio_project_id;
      if v_current_slug is distinct from v_slug then
        raise exception 'Adres opublikowanej realizacji się nie zmienia (linki i pozycja w Google).' using errcode = '22023';
      end if;
    end if;
  end if;
  if exists (select 1 from public.portfolio_projects p where p.slug = v_slug and p.id is distinct from v_project) then
    raise exception 'Adres „%” ma już inna realizacja na stronie — zmień adres.', v_slug using errcode = '23505';
  end if;

  if v_project is null then
    insert into public.portfolio_projects (
      title, slug, category, client, location, event_date, description, detailed_description, meta_description, keywords, tags,
      image, alt, image_metadata, gallery, features, event_city_slug, reference_city_slugs, conference_reference_enabled,
      is_featured, order_index, video_url, created_at, updated_at
    ) values (
      p_site ->> 'title', v_slug, p_site ->> 'category', p_site ->> 'client', p_site ->> 'location',
      nullif(p_site ->> 'event_date', '')::date, p_site ->> 'description', p_site ->> 'detailed_description',
      p_site ->> 'meta_description',
      array(select jsonb_array_elements_text(coalesce(p_site -> 'keywords', '[]'::jsonb))),
      array(select jsonb_array_elements_text(coalesce(p_site -> 'tags', '[]'::jsonb))),
      p_site ->> 'image', p_site ->> 'alt', p_site -> 'image_metadata', coalesce(p_site -> 'gallery', '[]'::jsonb),
      coalesce(p_site -> 'features', '[]'::jsonb), p_site ->> 'event_city_slug',
      array(select jsonb_array_elements_text(coalesce(p_site -> 'reference_city_slugs', '[]'::jsonb))),
      (p_site ->> 'conference_reference_enabled')::boolean, coalesce((p_site ->> 'is_featured')::boolean, false),
      coalesce((p_site ->> 'order_index')::integer, 0), nullif(p_site ->> 'video_url', ''), now(), now()
    ) returning id into v_project;
  else
    update public.portfolio_projects set
      title = p_site ->> 'title',
      category = p_site ->> 'category',
      client = p_site ->> 'client',
      location = p_site ->> 'location',
      event_date = nullif(p_site ->> 'event_date', '')::date,
      description = p_site ->> 'description',
      detailed_description = p_site ->> 'detailed_description',
      meta_description = p_site ->> 'meta_description',
      keywords = array(select jsonb_array_elements_text(coalesce(p_site -> 'keywords', '[]'::jsonb))),
      tags = array(select jsonb_array_elements_text(coalesce(p_site -> 'tags', '[]'::jsonb))),
      image = p_site ->> 'image',
      alt = p_site ->> 'alt',
      image_metadata = p_site -> 'image_metadata',
      gallery = coalesce(p_site -> 'gallery', '[]'::jsonb),
      features = coalesce(p_site -> 'features', '[]'::jsonb),
      event_city_slug = p_site ->> 'event_city_slug',
      reference_city_slugs = array(select jsonb_array_elements_text(coalesce(p_site -> 'reference_city_slugs', '[]'::jsonb))),
      conference_reference_enabled = (p_site ->> 'conference_reference_enabled')::boolean,
      is_featured = coalesce((p_site ->> 'is_featured')::boolean, false),
      order_index = coalesce((p_site ->> 'order_index')::integer, 0),
      video_url = nullif(p_site ->> 'video_url', ''),
      updated_at = now()
    where id = v_project;
  end if;

  perform set_config('mavinci.portfolio_publish', 'on', true);
  update public.marketing_portfolio_items
     set portfolio_project_id = v_project, published_hash = p_hash, published_at = now(),
         published_by = public.current_crm_employee_id()
   where id = p_id;
  perform set_config('mavinci.portfolio_publish', 'off', true);
  return jsonb_build_object('portfolioProjectId', v_project);
end;
$$;

-- Kopia robocza istniejącej realizacji ze strony (pierwsze otwarcie „Realizacji”) — jedna na wiersz strony.
create or replace function public.portfolio_item_adopt(p_project uuid, p_content jsonb, p_hash text, p_company uuid)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
begin
  if not public.can_edit_website() then
    raise exception 'Realizacje prowadzi osoba z uprawnieniem do edycji strony.' using errcode = '42501';
  end if;
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_content) <> 'object' then
    raise exception 'Nieprawidłowe dane realizacji.' using errcode = '22023';
  end if;
  select id into v_id from public.marketing_portfolio_items where portfolio_project_id = p_project;
  if found then
    return v_id;
  end if;
  if not exists (select 1 from public.portfolio_projects where id = p_project) then
    raise exception 'Nie znaleziono realizacji na stronie.' using errcode = 'P0002';
  end if;
  perform set_config('mavinci.portfolio_publish', 'on', true);
  insert into public.marketing_portfolio_items (portfolio_project_id, company_id, content, published_hash, published_at)
  values (p_project, p_company, p_content, p_hash, now())
  returning id into v_id;
  perform set_config('mavinci.portfolio_publish', 'off', true);
  return v_id;
end;
$$;

-- Wersja ze strony do kopii roboczej (zmiana zrobiona w trybie edycji strony albo „Pobierz wersję ze strony”).
create or replace function public.portfolio_item_sync(p_id uuid, p_content jsonb, p_hash text)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_rows integer;
begin
  if not public.can_edit_website() then
    raise exception 'Realizacje prowadzi osoba z uprawnieniem do edycji strony.' using errcode = '42501';
  end if;
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_content) <> 'object' then
    raise exception 'Nieprawidłowe dane realizacji.' using errcode = '22023';
  end if;
  perform set_config('mavinci.portfolio_publish', 'on', true);
  update public.marketing_portfolio_items set content = p_content, published_hash = p_hash
   where id = p_id and portfolio_project_id is not null;
  get diagnostics v_rows = row_count;
  perform set_config('mavinci.portfolio_publish', 'off', true);
  if v_rows = 0 then
    raise exception 'Nie znaleziono opublikowanej realizacji.' using errcode = 'P0002';
  end if;
end;
$$;

-- Usunięcie realizacji ze strony (kopia robocza zostaje jako szkic).
create or replace function public.portfolio_item_unpublish(p_id uuid, p_version integer)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_item public.marketing_portfolio_items%rowtype;
begin
  if not public.can_edit_website() then
    raise exception 'Realizacje prowadzi osoba z uprawnieniem do edycji strony.' using errcode = '42501';
  end if;
  select * into v_item from public.marketing_portfolio_items where id = p_id for update;
  if not found then
    raise exception 'Nie znaleziono realizacji.' using errcode = 'P0002';
  end if;
  if v_item.version <> p_version then
    raise exception 'Realizację zmieniono w innym oknie. Odśwież widok.' using errcode = '40001';
  end if;
  if v_item.portfolio_project_id is not null then
    delete from public.portfolio_projects where id = v_item.portfolio_project_id;
  end if;
  perform set_config('mavinci.portfolio_publish', 'on', true);
  update public.marketing_portfolio_items
     set portfolio_project_id = null, published_hash = null, published_at = null, published_by = null
   where id = p_id;
  perform set_config('mavinci.portfolio_publish', 'off', true);
end;
$$;

revoke all on function public.portfolio_item_publish(uuid, integer, jsonb, text) from public, anon;
revoke all on function public.portfolio_item_adopt(uuid, jsonb, text, uuid) from public, anon;
revoke all on function public.portfolio_item_sync(uuid, jsonb, text) from public, anon;
revoke all on function public.portfolio_item_unpublish(uuid, integer) from public, anon;
grant execute on function public.portfolio_item_publish(uuid, integer, jsonb, text) to authenticated, service_role;
grant execute on function public.portfolio_item_adopt(uuid, jsonb, text, uuid) to authenticated, service_role;
grant execute on function public.portfolio_item_sync(uuid, jsonb, text) to authenticated, service_role;
grant execute on function public.portfolio_item_unpublish(uuid, integer) to authenticated, service_role;
