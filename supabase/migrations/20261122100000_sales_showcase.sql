-- Strefa sprzedawcy → „Prezentacje”: materiały na spotkania z klientami (Etap 1: przygotowanie w CRM i na Macu, podgląd jak
-- na iPadzie; w kolejnym etapie tryb prezentacji na iPadzie z pobieraniem offline). Wszystko przez
-- `/bridge/native/v1/showcase` tokenem pracownika — RLS jak w CRM.
--
-- • `sales_showcase_sections` — działy pokazu (np. „Scena i technika”, „Ekrany LED”, „Atrakcje”): nazwa, opis, ikona, okładka,
--   kolejność (przeciąganie), widoczność na spotkaniach.
-- • `sales_showcase_items` — karty prezentacji w dziale: tytuł, hasło, powiązane produkty katalogu (`product_ids` — opis,
--   korzyści, warianty, ceny i przygotowanie serwer czyta na bieżąco z Oferty → Produkty) i treść (`content`: wstęp, zdjęcie
--   główne, bloki „Jak to wygląda”, „Korzyści”, galeria, „Jak przygotowujemy”, pytania klientów, specyfikacja, realizacje).
--   Budowę treści sprawdza serwer Next (`src/lib/showcase/showcaseShared.ts`), baza pilnuje typu i rozmiaru.
-- • Zdjęcia — prywatny bucket `sales-showcase` (`items/<karta>/…`, `sections/<dział>/…`; wersje WebP z serwera Next).
--
-- Uprawnienia (Ustawienia → Poziomy dostępu → sekcja „Prezentacje”, profil pracownika → Uprawnienia):
--   presentations_view   — przeglądanie i pokazywanie prezentacji (także `offers_view` / `offers_create`),
--   presentations_manage — przygotowanie: działy, karty, zdjęcia, kolejność (także `offers_manage`); obejmuje podgląd.
-- Administrator ma wszystko; sprzedawca z portalu — nic. Osoby bez zarządzania widzą tylko widoczne działy i karty.
-- `version` rośnie przy zmianie treści (zapis z innego okna nie nadpisze zmian), kolejność i przeniesienia jej nie zmieniają.
-- Plik idempotentny — można go wykonać ponownie.

begin;

-- 1. Dostęp ---------------------------------------------------------------------------------------------------------------

create or replace function public.sales_showcase_can(p_scope text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce((
    select not public.current_session_is_seller_portal() and (
      e.role::text = 'admin' or e.access_level::text = 'admin' or 'admin' = any(coalesce(e.permissions, '{}'::text[]))
      or coalesce(e.permissions, '{}'::text[]) && case p_scope
        when 'view' then array['presentations_view', 'presentations_manage', 'offers_view', 'offers_create', 'offers_manage']
        when 'manage' then array['presentations_manage', 'offers_manage']
        else array[]::text[]
      end
    )
    from public.employees e
    where e.id = public.current_crm_employee_id() and coalesce(e.is_active, true)
  ), false);
$$;

revoke all on function public.sales_showcase_can(text) from public, anon;
grant execute on function public.sales_showcase_can(text) to authenticated, service_role;

-- Zakresy bieżącego pracownika — przyciski w CRM, na Macu i w telefonie (te same reguły co RLS).
create or replace function public.sales_showcase_access()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'view', public.sales_showcase_can('view'),
    'manage', public.sales_showcase_can('manage'),
    'employeeId', public.current_crm_employee_id()
  );
$$;

revoke all on function public.sales_showcase_access() from public, anon;
grant execute on function public.sales_showcase_access() to authenticated, service_role;

-- 2. Działy i karty ---------------------------------------------------------------------------------------------------------

create table if not exists public.sales_showcase_sections (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subtitle text not null default '',
  icon text not null default 'sparkles',
  cover jsonb,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references public.employees(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.employees(id) on delete set null,
  constraint sales_showcase_sections_title_check check (char_length(btrim(title)) between 1 and 80),
  constraint sales_showcase_sections_subtitle_check check (char_length(subtitle) <= 240),
  constraint sales_showcase_sections_icon_check check (icon ~ '^[a-z][a-z0-9-]{0,39}$'),
  constraint sales_showcase_sections_cover_check check (cover is null or (jsonb_typeof(cover) = 'object' and pg_column_size(cover) <= 4000)),
  constraint sales_showcase_sections_version_check check (version >= 1)
);

create table if not exists public.sales_showcase_items (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sales_showcase_sections(id) on delete cascade,
  title text not null,
  tagline text not null default '',
  product_ids uuid[] not null default '{}'::uuid[],
  content jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references public.employees(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.employees(id) on delete set null,
  constraint sales_showcase_items_title_check check (char_length(btrim(title)) between 1 and 120),
  constraint sales_showcase_items_tagline_check check (char_length(tagline) <= 240),
  constraint sales_showcase_items_products_check check (cardinality(product_ids) <= 12 and array_position(product_ids, null) is null),
  constraint sales_showcase_items_content_check check (jsonb_typeof(content) = 'object' and pg_column_size(content) <= 400000),
  constraint sales_showcase_items_version_check check (version >= 1)
);

create index if not exists sales_showcase_sections_order_idx on public.sales_showcase_sections (sort_order, title);
create index if not exists sales_showcase_items_section_idx on public.sales_showcase_items (section_id, sort_order);
create index if not exists sales_showcase_items_products_idx on public.sales_showcase_items using gin (product_ids);

comment on table public.sales_showcase_sections is 'Strefa sprzedawcy → Prezentacje: działy pokazu na spotkania z klientami.';
comment on table public.sales_showcase_items is
  'Strefa sprzedawcy → Prezentacje: karty pokazu (produkty katalogu + zdjęcia, korzyści, przygotowanie, pytania klientów).';

-- Autor i wersja. `version` rośnie przy zmianie treści; kolejność (`sort_order`) i dział karty (`section_id`) — bez zmiany
-- wersji (przeciąganie na liście nie unieważnia otwartego edytora).
create or replace function public.sales_showcase_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := public.current_crm_employee_id();
  v_moves constant text[] := array['sort_order', 'section_id', 'version', 'created_at', 'created_by', 'updated_at', 'updated_by'];
  v_meta constant text[] := array['version', 'created_at', 'created_by', 'updated_at', 'updated_by'];
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.created_at := now();
    new.updated_at := now();
    new.created_by := coalesce(v_actor, new.created_by);
    new.updated_by := coalesce(v_actor, new.updated_by);
    return new;
  end if;
  new.created_at := old.created_at;
  new.created_by := case when new.created_by is null then null else old.created_by end;
  if (to_jsonb(new) - v_moves) is distinct from (to_jsonb(old) - v_moves) then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  if (to_jsonb(new) - v_meta) is distinct from (to_jsonb(old) - v_meta) then
    new.updated_at := now();
    new.updated_by := coalesce(v_actor, case when new.updated_by is null then null else old.updated_by end);
  else
    -- Bez zmian treści (także ON DELETE SET NULL po usunięciu pracownika — wtedy autor zostaje pusty).
    new.updated_at := old.updated_at;
    new.updated_by := case when new.updated_by is null then null else old.updated_by end;
  end if;
  return new;
end;
$$;

revoke all on function public.sales_showcase_guard() from public, anon, authenticated;

drop trigger if exists sales_showcase_sections_guard on public.sales_showcase_sections;
create trigger sales_showcase_sections_guard before insert or update on public.sales_showcase_sections
  for each row execute function public.sales_showcase_guard();
drop trigger if exists sales_showcase_items_guard on public.sales_showcase_items;
create trigger sales_showcase_items_guard before insert or update on public.sales_showcase_items
  for each row execute function public.sales_showcase_guard();

alter table public.sales_showcase_sections enable row level security;
alter table public.sales_showcase_items enable row level security;

drop policy if exists sales_showcase_sections_select on public.sales_showcase_sections;
create policy sales_showcase_sections_select on public.sales_showcase_sections for select to authenticated
  using (public.sales_showcase_can('manage') or (is_active and public.sales_showcase_can('view')));
drop policy if exists sales_showcase_sections_insert on public.sales_showcase_sections;
create policy sales_showcase_sections_insert on public.sales_showcase_sections for insert to authenticated
  with check (public.sales_showcase_can('manage'));
drop policy if exists sales_showcase_sections_update on public.sales_showcase_sections;
create policy sales_showcase_sections_update on public.sales_showcase_sections for update to authenticated
  using (public.sales_showcase_can('manage')) with check (public.sales_showcase_can('manage'));
drop policy if exists sales_showcase_sections_delete on public.sales_showcase_sections;
create policy sales_showcase_sections_delete on public.sales_showcase_sections for delete to authenticated
  using (public.sales_showcase_can('manage'));

drop policy if exists sales_showcase_items_select on public.sales_showcase_items;
create policy sales_showcase_items_select on public.sales_showcase_items for select to authenticated
  using (public.sales_showcase_can('manage') or (
    is_active and public.sales_showcase_can('view')
    and exists (select 1 from public.sales_showcase_sections s where s.id = section_id and s.is_active)
  ));
drop policy if exists sales_showcase_items_insert on public.sales_showcase_items;
create policy sales_showcase_items_insert on public.sales_showcase_items for insert to authenticated
  with check (public.sales_showcase_can('manage'));
drop policy if exists sales_showcase_items_update on public.sales_showcase_items;
create policy sales_showcase_items_update on public.sales_showcase_items for update to authenticated
  using (public.sales_showcase_can('manage')) with check (public.sales_showcase_can('manage'));
drop policy if exists sales_showcase_items_delete on public.sales_showcase_items;
create policy sales_showcase_items_delete on public.sales_showcase_items for delete to authenticated
  using (public.sales_showcase_can('manage'));

revoke all on public.sales_showcase_sections, public.sales_showcase_items from public, anon;
grant select, insert, update, delete on public.sales_showcase_sections, public.sales_showcase_items to authenticated;
grant all on public.sales_showcase_sections, public.sales_showcase_items to service_role;

-- 3. Kolejność (przeciąganie): `p_section` NULL — działy w podanej kolejności; dział — karty w podanej kolejności (karta z innego
-- działu przechodzi do tego działu). Lista musi zawierać każdy element dokładnie raz.
create or replace function public.sales_showcase_reorder(p_section uuid, p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_rows integer;
begin
  if not public.sales_showcase_can('manage') then
    raise exception 'Kolejność zmienia osoba z uprawnieniem do przygotowania prezentacji.' using errcode = '42501';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 500 or array_position(p_ids, null) is not null
     or (select count(distinct x) from unnest(p_ids) x) <> cardinality(p_ids) then
    raise exception 'Nieprawidłowa kolejność.' using errcode = '22023';
  end if;
  if p_section is null then
    update public.sales_showcase_sections s set sort_order = o.ord - 1
      from unnest(p_ids) with ordinality as o(id, ord)
     where s.id = o.id;
    get diagnostics v_rows = row_count;
  else
    if not exists (select 1 from public.sales_showcase_sections where id = p_section) then
      raise exception 'Nie znaleziono działu.' using errcode = 'P0002';
    end if;
    update public.sales_showcase_items i set section_id = p_section, sort_order = o.ord - 1
      from unnest(p_ids) with ordinality as o(id, ord)
     where i.id = o.id;
    get diagnostics v_rows = row_count;
  end if;
  if v_rows <> cardinality(p_ids) then
    raise exception 'Część elementów usunięto albo zmieniono w innym oknie. Odśwież widok.' using errcode = '40001';
  end if;
end;
$$;

revoke all on function public.sales_showcase_reorder(uuid, uuid[]) from public, anon;
grant execute on function public.sales_showcase_reorder(uuid, uuid[]) to authenticated, service_role;

-- 4. Magazyn: prywatny bucket `sales-showcase` -----------------------------------------------------------------------------
-- `items/<karta>/<plik>.webp`, `sections/<dział>/<plik>.webp` — odczyt: podgląd prezentacji; zapis i usuwanie: przygotowanie.
-- Obiekty nie są nadpisywane (nowa nazwa przy każdym zdjęciu) — bez prawa UPDATE.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sales-showcase', 'sales-showcase', false, 26214400, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Sales showcase read" on storage.objects;
create policy "Sales showcase read" on storage.objects for select to authenticated
  using (bucket_id = 'sales-showcase' and public.sales_showcase_can('view'));
drop policy if exists "Sales showcase insert" on storage.objects;
create policy "Sales showcase insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'sales-showcase' and public.sales_showcase_can('manage')
    and name ~ '^(items|sections)/[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}/[A-Za-z0-9._-]{1,100}$'
  );
drop policy if exists "Sales showcase delete" on storage.objects;
create policy "Sales showcase delete" on storage.objects for delete to authenticated
  using (bucket_id = 'sales-showcase' and public.sales_showcase_can('manage'));

-- 5. Uprawnienia sekcji „Prezentacje” w „Dostępie według sekcji” (moduł `presentations`). Treść funkcji bez zmian poza listą
-- znanych zakresów: + presentations_view, presentations_manage.

CREATE OR REPLACE FUNCTION public.admin_set_employee_section_permissions(p_employee_id uuid, p_module text, p_permissions text[], p_expected_permissions text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_employee public.employees%ROWTYPE; v_current text[]; v_expected text[]; v_next text[];
 v_known constant text[] := ARRAY['events_view','events_view_planning','events_view_operational','events_manage','events_create','event_categories_manage','calendar_view','calendar_manage','calendar_view_accepted_only','tasks_view','tasks_manage','tasks_create','offers_view','offers_manage','offers_create','offers_brochures_view_own','offers_brochures_view_all','contracts_view','contracts_manage','contracts_create','contracts_own_only','offers_own_only','events_own_only','attractions_view','attractions_manage','attractions_create','clients_view','clients_manage','clients_create','contacts_view','contacts_manage','contacts_create','inquiries_view','inquiries_manage','inquiries_view_pool','inquiries_view_own','inquiries_manage_own','inquiries_view_team','inquiries_manage_team','inquiries_view_all','inquiries_manage_all','inquiries_assign','messages_view','messages_manage','messages_assign','marketing_campaigns_view','marketing_campaigns_manage','marketing_campaigns_approve','marketing_social_view','marketing_social_create','marketing_social_approve','marketing_social_publish','materials_view','materials_manage','presentations_view','presentations_manage','chat_view','chat_manage','chat_create_group','webhooks_view','webhooks_manage','equipment_view','equipment_manage','equipment_create','fleet_view','fleet_manage','fleet_create','locations_view','locations_manage','locations_create','subcontractors_manage','time_tracking_view_own','time_tracking_view','time_tracking_manage','mavinci_live_view','mavinci_live_manage','mavinci_live_light_magic','mavinci_live_quiz_show','mavinci_live_familiada','mavinci_live_wedding_show','mavinci_live_streaming','finances_view','finances_manage','invoices_view','invoices_manage','databases_view','databases_manage','tenders_view','personnel_view','personnel_manage','employees_view','employees_manage','employees_create','employees_permissions','page_view','page_manage','website_edit'];
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

commit;
