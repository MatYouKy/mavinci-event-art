-- Cenniki sezonowe (etap 1 oferty weselnej) i domyślna marka kategorii eventu.
--
-- Cena zależy od roku eventu, a nie od dnia podpisania: wesele na 2028 podpisane w 2026 ma ceny z cennika 2028.
-- Marka realizująca ma osobne cenniki (`price_lists`) z okresem sezonu i cenami netto produktów i wariantów
-- (`price_list_entries`). Aktywne cenniki jednej marki nie mogą na siebie zachodzić.
--
-- Gwarancja ceny: cennik podpowiada cenę przy dodawaniu pozycji (kreator oferty, „Dodaj pozycję”, edycja wariantu —
-- CRM, Mac, telefon przez serwer). Zapisana pozycja trzyma swoją cenę; nic nie zmienia jej samo. Oferta zapamiętuje
-- cennik, z którego powstała (`offers.price_list_id`), a pozycje — ceny wszystkich wariantów z tego cennika
-- (`offer_items.variant_prices_net`), więc późniejsza zmiana cennika nie rusza wysłanej oferty. Zmiana cen istniejącej
-- oferty tylko świadomie: „Przelicz według cennika” (`apply_price_list_to_offer` — najpierw podgląd różnic).
--
-- Marka oferty: oferta → event → domyślna marka kategorii eventu. Data: data eventu → data z oferty → dziś (Warszawa).
-- Oferty sprzedawców (portal) mają indywidualny cennik sprzedawcy i cennik sezonowy ich nie dotyczy.
--
-- Kategoria eventu może mieć domyślną markę (`event_categories.default_my_company_id`), a z `company_locked` — markę
-- obowiązkową: nowy event tej kategorii zawsze dostaje tę markę. Wesele → Event Rulers (obowiązkowo). Przyszłe wesela
-- bez marki dostają Event Rulers; wesela z wybraną inną marką i przeszłe eventy zostają bez zmian.
--
-- Kod CRM/Mac działa także przed tą migracją (brak funkcji `offer_season_prices` = brak cennika, ceny z katalogu).

-- 1. Domyślna marka kategorii eventu ----------------------------------------------------------------------------------------

alter table public.event_categories
  add column if not exists default_my_company_id uuid references public.my_companies(id) on delete set null,
  add column if not exists company_locked boolean not null default false;

comment on column public.event_categories.default_my_company_id is
  'Marka realizująca podstawiana nowym eventom tej kategorii (i podkategorii bez własnej). Wyznacza też cennik sezonowy oferty.';
comment on column public.event_categories.company_locked is
  'Marka obowiązkowa: nowy event tej kategorii zawsze dostaje default_my_company_id (np. Wesele → Event Rulers).';

update public.event_categories c
   set default_my_company_id = m.id,
       company_locked = true
  from public.my_companies m
 where lower(btrim(c.name)) = 'wesele'
   and lower(btrim(m.name)) = 'event rulers'
   and c.default_my_company_id is null;

create or replace function public.apply_event_category_company()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_company uuid;
  v_locked boolean;
  v_category text;
  v_company_name text;
begin
  if new.category_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.category_id is not distinct from old.category_id then
    return new;
  end if;

  select coalesce(c.default_my_company_id, p.default_my_company_id),
         case when c.default_my_company_id is not null then c.company_locked else coalesce(p.company_locked, false) end,
         c.name
    into v_company, v_locked, v_category
    from public.event_categories c
    left join public.event_categories p on p.id = c.parent_category_id
   where c.id = new.category_id;

  if v_company is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.my_company_id is null or (v_locked and new.my_company_id is distinct from v_company) then
      if v_locked and auth.uid() is not null
         and not coalesce(public.current_session_is_seller_portal(), false)
         and not coalesce(public.current_employee_can_access_company(v_company), false) then
        select m.name into v_company_name from public.my_companies m where m.id = v_company;
        raise exception 'Eventy z kategorii „%” realizuje marka %. Nie masz dostępu do tej marki — poproś administratora o dostęp.',
          v_category, coalesce(v_company_name, 'przypisana do kategorii') using errcode = '42501';
      end if;
      new.my_company_id := v_company;
    end if;
  elsif old.my_company_id is null and new.my_company_id is null then
    -- Zmiana kategorii istniejącego eventu uzupełnia tylko brakującą markę (wybranej marki nie przenosimy).
    new.my_company_id := v_company;
  end if;
  return new;
end $$;

drop trigger if exists a_event_category_company on public.events;
create trigger a_event_category_company
  before insert or update of category_id on public.events
  for each row execute function public.apply_event_category_company();

-- Przyszłe eventy kategorii z marką obowiązkową, które nie mają marki (np. wesela bez marki → Event Rulers).
update public.events e
   set my_company_id = c.default_my_company_id
  from public.event_categories c
 where c.id = e.category_id
   and c.company_locked
   and c.default_my_company_id is not null
   and e.my_company_id is null
   and e.event_date >= now();

-- 2. Cenniki --------------------------------------------------------------------------------------------------------------

create table if not exists public.price_lists (
  id uuid primary key default gen_random_uuid(),
  my_company_id uuid not null references public.my_companies(id) on delete restrict,
  name text not null,
  season_from date not null,
  season_to date not null,
  status text not null default 'draft',
  notes text not null default '',
  created_by uuid references public.employees(id) on delete set null,
  updated_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint price_lists_name_check check (char_length(btrim(name)) between 1 and 120),
  constraint price_lists_status_check check (status in ('draft', 'active', 'archived')),
  constraint price_lists_season_check check (season_to >= season_from and season_to - season_from <= 1100),
  constraint price_lists_notes_check check (char_length(notes) <= 2000),
  constraint price_lists_no_active_overlap exclude using gist (
    my_company_id with =,
    daterange(season_from, season_to, '[]') with &&
  ) where (status = 'active')
);

comment on table public.price_lists is
  'Cenniki sezonowe marki: ceny netto produktów i wariantów dla eventów w okresie season_from–season_to (data eventu).';
comment on column public.price_lists.status is
  'draft — w przygotowaniu (nie podpowiada cen); active — obowiązuje w swoim sezonie; archived — historia (oferty zachowują ceny).';

create index if not exists price_lists_company_season_idx on public.price_lists (my_company_id, season_from, season_to);

create table if not exists public.price_list_entries (
  id uuid primary key default gen_random_uuid(),
  price_list_id uuid not null references public.price_lists(id) on delete cascade,
  product_id uuid not null references public.offer_products(id) on delete cascade,
  product_variant_id uuid references public.offer_product_variants(id) on delete cascade,
  price_net numeric(12, 2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint price_list_entries_price_check check (price_net >= 0 and price_net <= 999999999.99)
);

comment on table public.price_list_entries is
  'Cena netto w cenniku: produkt (product_variant_id null — cena bazowa produktu) albo konkretny wariant produktu.';

create unique index if not exists price_list_entries_unique
  on public.price_list_entries (price_list_id, product_id, product_variant_id) nulls not distinct;
create index if not exists price_list_entries_product_idx on public.price_list_entries (product_id);

alter table public.offers
  add column if not exists price_list_id uuid references public.price_lists(id) on delete restrict;
create index if not exists offers_price_list_idx on public.offers (price_list_id) where price_list_id is not null;

comment on column public.offers.price_list_id is
  'Cennik sezonowy, według którego wyceniono ofertę (gwarancja ceny — zmiana tylko przez „Przelicz według cennika”).';

-- 3. Uprawnienia ------------------------------------------------------------------------------------------------------------

-- Podgląd: pracownicy CRM z dostępem do marki (bez portalu sprzedawcy). Zarządzanie: jak produkty oferty (admin / offers_manage).
create or replace function public.price_lists_can_view(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.current_employee_id() is not null
     and not coalesce(public.current_session_is_seller_portal(), false)
     and coalesce(public.current_employee_can_access_company(p_company_id), false);
$$;

create or replace function public.price_lists_can_manage(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.price_lists_can_view(p_company_id)
     and exists (
       select 1
         from public.employees e
        where e.id = public.current_employee_id()
          and (e.role = 'admin'
               or 'admin' = any(coalesce(e.permissions, '{}'::text[]))
               or 'offers_manage' = any(coalesce(e.permissions, '{}'::text[])))
     );
$$;

revoke all on function public.price_lists_can_view(uuid) from public, anon;
revoke all on function public.price_lists_can_manage(uuid) from public, anon;
grant execute on function public.price_lists_can_view(uuid) to authenticated, service_role;
grant execute on function public.price_lists_can_manage(uuid) to authenticated, service_role;

-- 4. Strażnicy zapisu ------------------------------------------------------------------------------------------------------

create or replace function public.price_lists_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_other text;
  v_from date;
  v_to date;
begin
  new.name := btrim(coalesce(new.name, ''));
  new.notes := btrim(coalesce(new.notes, ''));
  if new.status = 'active' then
    select p.name, p.season_from, p.season_to into v_other, v_from, v_to
      from public.price_lists p
     where p.my_company_id = new.my_company_id
       and p.status = 'active'
       and p.id <> new.id
       and daterange(p.season_from, p.season_to, '[]') && daterange(new.season_from, new.season_to, '[]')
     order by p.season_from
     limit 1;
    if v_other is not null then
      raise exception 'Cennik „%” tej marki obowiązuje już w części tego okresu (% – %). Zmień daty albo zarchiwizuj tamten cennik.',
        v_other, to_char(v_from, 'DD.MM.YYYY'), to_char(v_to, 'DD.MM.YYYY') using errcode = '23P01';
    end if;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(public.current_crm_employee_id(), new.created_by);
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := coalesce(public.current_crm_employee_id(), new.updated_by);
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists price_lists_guard on public.price_lists;
create trigger price_lists_guard
  before insert or update on public.price_lists
  for each row execute function public.price_lists_guard();

create or replace function public.price_list_entries_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.product_variant_id is not null and not exists (
    select 1 from public.offer_product_variants v where v.id = new.product_variant_id and v.product_id = new.product_id
  ) then
    raise exception 'Wariant nie należy do wybranego produktu.' using errcode = '22023';
  end if;
  new.price_net := round(new.price_net, 2);
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
    if new.price_list_id is distinct from old.price_list_id then
      raise exception 'Pozycji nie można przenieść do innego cennika.' using errcode = '22023';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists price_list_entries_guard on public.price_list_entries;
create trigger price_list_entries_guard
  before insert or update on public.price_list_entries
  for each row execute function public.price_list_entries_guard();

-- 5. RLS --------------------------------------------------------------------------------------------------------------------

alter table public.price_lists enable row level security;
alter table public.price_list_entries enable row level security;

drop policy if exists price_lists_select on public.price_lists;
create policy price_lists_select on public.price_lists for select to authenticated
  using (public.price_lists_can_view(my_company_id));

drop policy if exists price_lists_insert on public.price_lists;
create policy price_lists_insert on public.price_lists for insert to authenticated
  with check (public.price_lists_can_manage(my_company_id));

drop policy if exists price_lists_update on public.price_lists;
create policy price_lists_update on public.price_lists for update to authenticated
  using (public.price_lists_can_manage(my_company_id))
  with check (public.price_lists_can_manage(my_company_id));

drop policy if exists price_lists_delete on public.price_lists;
create policy price_lists_delete on public.price_lists for delete to authenticated
  using (public.price_lists_can_manage(my_company_id));

drop policy if exists price_list_entries_select on public.price_list_entries;
create policy price_list_entries_select on public.price_list_entries for select to authenticated
  using (exists (select 1 from public.price_lists p where p.id = price_list_id and public.price_lists_can_view(p.my_company_id)));

drop policy if exists price_list_entries_insert on public.price_list_entries;
create policy price_list_entries_insert on public.price_list_entries for insert to authenticated
  with check (exists (select 1 from public.price_lists p where p.id = price_list_id and public.price_lists_can_manage(p.my_company_id)));

drop policy if exists price_list_entries_update on public.price_list_entries;
create policy price_list_entries_update on public.price_list_entries for update to authenticated
  using (exists (select 1 from public.price_lists p where p.id = price_list_id and public.price_lists_can_manage(p.my_company_id)))
  with check (exists (select 1 from public.price_lists p where p.id = price_list_id and public.price_lists_can_manage(p.my_company_id)));

drop policy if exists price_list_entries_delete on public.price_list_entries;
create policy price_list_entries_delete on public.price_list_entries for delete to authenticated
  using (exists (select 1 from public.price_lists p where p.id = price_list_id and public.price_lists_can_manage(p.my_company_id)));

revoke all on public.price_lists from public, anon, authenticated;
revoke all on public.price_list_entries from public, anon, authenticated;
grant select, insert, update, delete on public.price_lists to authenticated;
grant select, insert, update, delete on public.price_list_entries to authenticated;
grant all on public.price_lists to service_role;
grant all on public.price_list_entries to service_role;

-- 6. Kontekst ceny oferty i ceny sezonu ------------------------------------------------------------------------------------

-- Marka i data, według których oferta (albo nowa oferta eventu) bierze cennik. Czyta przez RLS wywołującego.
create or replace function public.offer_price_context(p_event_id uuid default null, p_offer_id uuid default null)
returns table (
  company_id uuid,
  price_date date,
  date_source text,
  offer_price_list_id uuid,
  sales_channel text,
  offer_status text
)
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_event_id uuid := p_event_id;
  v_offer_found boolean := false;
  v_offer_company uuid;
  v_offer_date timestamptz;
  v_event_company uuid;
  v_event_date timestamptz;
  v_category_company uuid;
begin
  if p_offer_id is not null then
    select o.event_id, o.my_company_id, o.event_date, o.price_list_id, o.sales_channel, o.status
      into v_event_id, v_offer_company, v_offer_date, offer_price_list_id, sales_channel, offer_status
      from public.offers o
     where o.id = p_offer_id;
    v_offer_found := found;
    if not v_offer_found then
      raise exception 'Nie znaleziono oferty.' using errcode = 'P0002';
    end if;
    v_event_id := coalesce(v_event_id, p_event_id);
  end if;

  if v_event_id is not null then
    select e.my_company_id, e.event_date, coalesce(c.default_my_company_id, parent.default_my_company_id)
      into v_event_company, v_event_date, v_category_company
      from public.events e
      left join public.event_categories c on c.id = e.category_id
      left join public.event_categories parent on parent.id = c.parent_category_id
     where e.id = v_event_id;
    if not found and not v_offer_found then
      raise exception 'Nie znaleziono eventu.' using errcode = 'P0002';
    end if;
  end if;

  company_id := coalesce(v_offer_company, v_event_company, v_category_company);
  if v_event_date is not null then
    price_date := (v_event_date at time zone 'Europe/Warsaw')::date;
    date_source := 'event';
  elsif v_offer_date is not null then
    price_date := (v_offer_date at time zone 'Europe/Warsaw')::date;
    date_source := 'offer';
  else
    price_date := (now() at time zone 'Europe/Warsaw')::date;
    date_source := 'today';
  end if;
  return next;
end $$;

-- Aktywny cennik marki obejmujący datę (sezon) — null, gdy brak.
create or replace function public.season_price_list_id(p_company_id uuid, p_date date)
returns uuid
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select p.id
    from public.price_lists p
   where p.my_company_id = p_company_id
     and p.status = 'active'
     and p_date between p.season_from and p.season_to
   order by p.season_from desc
   limit 1;
$$;

create or replace function public.price_list_summary(p_price_list_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
           'id', p.id,
           'name', p.name,
           'season_from', p.season_from,
           'season_to', p.season_to,
           'status', p.status,
           'my_company_id', p.my_company_id,
           'company_name', m.name,
           'entry_count', (select count(*) from public.price_list_entries e where e.price_list_id = p.id)
         )
    from public.price_lists p
    left join public.my_companies m on m.id = p.my_company_id
   where p.id = p_price_list_id;
$$;

-- Ceny do podpowiedzi: cennik oferty (zapamiętany) albo cennik sezonu dla marki i daty eventu.
-- `suggested` — cennik sezonu, gdy różni się od zapamiętanego (np. event przeniesiony na inny rok).
create or replace function public.offer_season_prices(p_event_id uuid default null, p_offer_id uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  c record;
  v_season uuid;
  v_list uuid;
  v_source text;
begin
  if p_event_id is null and p_offer_id is null then
    return null;
  end if;
  select * into c from public.offer_price_context(p_event_id, p_offer_id);
  if coalesce(c.sales_channel, '') <> 'seller_portal' then
    if c.company_id is not null then
      v_season := public.season_price_list_id(c.company_id, c.price_date);
    end if;
    if c.offer_price_list_id is not null and exists (select 1 from public.price_lists p where p.id = c.offer_price_list_id) then
      v_list := c.offer_price_list_id;
      v_source := 'offer';
    elsif v_season is not null then
      v_list := v_season;
      v_source := 'season';
    end if;
  end if;
  return jsonb_build_object(
    'context', jsonb_build_object(
      'company_id', c.company_id,
      'company_name', (select m.name from public.my_companies m where m.id = c.company_id),
      'date', c.price_date,
      'date_source', c.date_source,
      'sales_channel', c.sales_channel,
      'offer_status', c.offer_status
    ),
    'source', v_source,
    'price_list', public.price_list_summary(v_list),
    'suggested', case when v_season is not null and v_season is distinct from v_list then public.price_list_summary(v_season) end,
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object('product_id', e.product_id, 'variant_id', e.product_variant_id, 'price_net', e.price_net)
                       order by e.product_id, e.product_variant_id nulls first)
        from public.price_list_entries e
       where e.price_list_id = v_list
    ), '[]'::jsonb)
  );
end $$;

-- 7. Przelicz ofertę według cennika (świadoma zmiana cen; najpierw podgląd) -------------------------------------------------

create or replace function public.apply_price_list_to_offer(
  p_offer_id uuid,
  p_price_list_id uuid default null,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  c record;
  v_list public.price_lists;
  v_list_id uuid := p_price_list_id;
  r record;
  v_conf jsonb;
  v_price numeric;
  v_base numeric;
  v_extras numeric;
  v_new_unit numeric;
  v_snapshot jsonb;
  v_before numeric;
  v_after numeric;
  v_rows integer;
  v_changes jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_unchanged integer := 0;
  v_delta numeric := 0;
begin
  select * into c from public.offer_price_context(null, p_offer_id);
  if c.sales_channel = 'seller_portal' then
    raise exception 'Oferta sprzedawcy ma indywidualny cennik sprzedawcy — cennik sezonowy jej nie dotyczy.' using errcode = '22023';
  end if;
  if c.offer_status = 'accepted' then
    raise exception 'Zaakceptowana oferta ma gwarantowane ceny. Aby wycenić ją według innego cennika, utwórz kopię oferty.' using errcode = '22023';
  end if;
  if v_list_id is null then
    if c.company_id is null then
      raise exception 'Oferta nie ma marki realizującej (w ofercie, evencie ani kategorii eventu) — nie wiadomo, który cennik zastosować.' using errcode = '22023';
    end if;
    v_list_id := public.season_price_list_id(c.company_id, c.price_date);
    if v_list_id is null then
      raise exception 'Brak aktywnego cennika marki na %.', to_char(c.price_date, 'DD.MM.YYYY') using errcode = 'P0002';
    end if;
  end if;

  select * into v_list from public.price_lists p where p.id = v_list_id;
  if not found then
    raise exception 'Nie znaleziono cennika.' using errcode = 'P0002';
  end if;
  if v_list.status <> 'active' and v_list.id is distinct from c.offer_price_list_id then
    raise exception 'Cennik „%” nie jest aktywny.', v_list.name using errcode = '22023';
  end if;
  if c.company_id is not null and v_list.my_company_id <> c.company_id then
    raise exception 'Cennik „%” należy do innej marki niż oferta.', v_list.name using errcode = '22023';
  end if;

  for r in
    select i.id, i.name, i.product_id, i.product_variant_id, i.unit_price, i.quantity, i.days, i.discount_percent,
           i.pricing_configuration, i.variant_prices_net, i.subtotal
      from public.offer_items i
     where i.offer_id = p_offer_id
     order by i.display_order nulls last, i.created_at
  loop
    v_conf := r.pricing_configuration;
    if r.product_id is null then
      v_skipped := v_skipped || jsonb_build_object('item_id', r.id, 'name', r.name, 'reason', 'Pozycja spoza katalogu');
      continue;
    end if;
    if v_conf ? 'modular' then
      v_skipped := v_skipped || jsonb_build_object('item_id', r.id, 'name', r.name, 'reason', 'Konfigurator — cena z kalkulatora');
      continue;
    end if;
    if coalesce(v_conf #>> '{product_package,selected_id}', '') <> '' then
      v_skipped := v_skipped || jsonb_build_object('item_id', r.id, 'name', r.name, 'reason', 'Pakiet sprzedażowy — cena pakietu');
      continue;
    end if;
    select e.price_net into v_price
      from public.price_list_entries e
     where e.price_list_id = v_list.id
       and e.product_id = r.product_id
       and e.product_variant_id is not distinct from r.product_variant_id;
    if not found then
      v_skipped := v_skipped || jsonb_build_object('item_id', r.id, 'name', r.name, 'reason', 'Brak w cenniku');
      continue;
    end if;

    v_base := case when jsonb_typeof(v_conf -> 'base_unit_price') = 'number'
                   then (v_conf ->> 'base_unit_price')::numeric else r.unit_price end;
    v_extras := case when v_conf is null then 0 else r.unit_price - v_base end;
    if v_base = v_price then
      v_unchanged := v_unchanged + 1;
      continue;
    end if;

    v_new_unit := v_price + v_extras;
    v_before := coalesce(r.subtotal, round(r.unit_price * r.quantity * coalesce(r.days, 1) * (1 - coalesce(r.discount_percent, 0) / 100), 2));
    v_after := round(v_new_unit * r.quantity * coalesce(r.days, 1), 2);
    v_after := v_after - round(v_new_unit * r.quantity * coalesce(r.days, 1) * coalesce(r.discount_percent, 0) / 100, 2);
    v_delta := v_delta + (v_after - v_before);
    v_changes := v_changes || jsonb_build_object(
      'item_id', r.id, 'name', r.name, 'quantity', r.quantity, 'days', coalesce(r.days, 1),
      'old_price', v_base, 'new_price', v_price, 'old_unit_price', r.unit_price, 'new_unit_price', v_new_unit,
      'old_subtotal', v_before, 'new_subtotal', v_after
    );

    if not p_dry_run then
      v_snapshot := coalesce(r.variant_prices_net, '{}'::jsonb) || coalesce((
        select jsonb_object_agg(e.product_variant_id::text, e.price_net)
          from public.price_list_entries e
         where e.price_list_id = v_list.id
           and e.product_id = r.product_id
           and e.product_variant_id is not null
      ), '{}'::jsonb);
      if r.product_variant_id is not null then
        v_snapshot := v_snapshot || jsonb_build_object(r.product_variant_id::text, v_price);
      end if;
      update public.offer_items
         set unit_price = v_new_unit,
             pricing_configuration = case when v_conf is null then null else jsonb_set(v_conf, '{base_unit_price}', to_jsonb(v_price)) end,
             variant_prices_net = v_snapshot
       where id = r.id;
      get diagnostics v_rows = row_count;
      if v_rows = 0 then
        raise exception 'Brak uprawnień do zmiany pozycji tej oferty.' using errcode = '42501';
      end if;
    end if;
  end loop;

  if not p_dry_run and c.offer_price_list_id is distinct from v_list.id then
    update public.offers set price_list_id = v_list.id where id = p_offer_id;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'Brak uprawnień do zmiany tej oferty.' using errcode = '42501';
    end if;
  end if;

  return jsonb_build_object(
    'price_list', public.price_list_summary(v_list.id),
    'changes', v_changes,
    'unchanged', v_unchanged,
    'skipped', v_skipped,
    'delta_net', round(v_delta, 2),
    'applied', not p_dry_run,
    'linked', c.offer_price_list_id is not distinct from v_list.id
  );
end $$;

-- 8. Przygotowanie cenników: kopia z podwyżką i uzupełnienie z katalogu ---------------------------------------------------

create or replace function public.price_list_round(p_value numeric, p_step numeric)
returns numeric
language sql
immutable
set search_path = pg_catalog
as $$
  select greatest(0, round(p_value / p_step) * p_step)::numeric(12, 2);
$$;

-- Nowy cennik (szkic) jako kopia innego, z podwyżką/obniżką o p_percent i zaokrągleniem do p_rounding zł.
create or replace function public.price_list_duplicate(
  p_source_id uuid,
  p_name text,
  p_season_from date,
  p_season_to date,
  p_percent numeric default 0,
  p_rounding numeric default 1
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_source public.price_lists;
  v_id uuid;
begin
  if p_percent is null or p_percent < -50 or p_percent > 200 then
    raise exception 'Zmiana cen musi mieścić się w zakresie od -50%% do +200%%.' using errcode = '22023';
  end if;
  if p_rounding is null or p_rounding not in (0.01, 1, 5, 10, 50, 100) then
    raise exception 'Nieprawidłowe zaokrąglenie cen.' using errcode = '22023';
  end if;
  select * into v_source from public.price_lists p where p.id = p_source_id;
  if not found then
    raise exception 'Nie znaleziono cennika do skopiowania.' using errcode = 'P0002';
  end if;
  insert into public.price_lists (my_company_id, name, season_from, season_to, status, notes)
  values (v_source.my_company_id, p_name, p_season_from, p_season_to, 'draft', v_source.notes)
  returning id into v_id;
  insert into public.price_list_entries (price_list_id, product_id, product_variant_id, price_net)
  select v_id, e.product_id, e.product_variant_id,
         public.price_list_round(e.price_net * (1 + p_percent / 100), p_rounding)
    from public.price_list_entries e
   where e.price_list_id = v_source.id;
  return v_id;
end $$;

-- Dodaje do cennika brakujące produkty i warianty z katalogu (aktywne; opcjonalnie jednej kategorii) z ceną katalogową
-- zmienioną o p_percent. Istniejących cen nie zmienia. Zwraca liczbę dodanych cen.
create or replace function public.price_list_fill_from_catalog(
  p_price_list_id uuid,
  p_category_id uuid default null,
  p_percent numeric default 0,
  p_rounding numeric default 1
)
returns integer
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
begin
  if p_percent is null or p_percent < -50 or p_percent > 200 then
    raise exception 'Zmiana cen musi mieścić się w zakresie od -50%% do +200%%.' using errcode = '22023';
  end if;
  if p_rounding is null or p_rounding not in (0.01, 1, 5, 10, 50, 100) then
    raise exception 'Nieprawidłowe zaokrąglenie cen.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.price_lists p where p.id = p_price_list_id) then
    raise exception 'Nie znaleziono cennika.' using errcode = 'P0002';
  end if;
  -- Bez produktów z konfiguratorem (cenę liczy kalkulator) i bez zerowej ceny bazowej (wycena indywidualna).
  with candidates as (
    select p.id as product_id, null::uuid as product_variant_id, p.base_price as price
      from public.offer_products p
     where p.is_active
       and p.configuration_schema is null
       and coalesce(p.base_price, 0) > 0
       and (p_category_id is null or p.category_id = p_category_id)
    union all
    select p.id, v.id, v.price_net
      from public.offer_products p
      join public.offer_product_variants v on v.product_id = p.id and v.is_active
     where p.is_active
       and p.configuration_schema is null
       and (p_category_id is null or p.category_id = p_category_id)
  ), inserted as (
    insert into public.price_list_entries (price_list_id, product_id, product_variant_id, price_net)
    select p_price_list_id, c.product_id, c.product_variant_id, public.price_list_round(c.price * (1 + p_percent / 100), p_rounding)
      from candidates c
    on conflict (price_list_id, product_id, product_variant_id) do nothing
    returning 1
  )
  select count(*) into v_count from inserted;
  return v_count;
end $$;

revoke all on function public.offer_price_context(uuid, uuid) from public, anon;
revoke all on function public.season_price_list_id(uuid, date) from public, anon;
revoke all on function public.price_list_summary(uuid) from public, anon;
revoke all on function public.offer_season_prices(uuid, uuid) from public, anon;
revoke all on function public.apply_price_list_to_offer(uuid, uuid, boolean) from public, anon;
revoke all on function public.price_list_round(numeric, numeric) from public, anon;
revoke all on function public.price_list_duplicate(uuid, text, date, date, numeric, numeric) from public, anon;
revoke all on function public.price_list_fill_from_catalog(uuid, uuid, numeric, numeric) from public, anon;
grant execute on function public.offer_price_context(uuid, uuid) to authenticated, service_role;
grant execute on function public.season_price_list_id(uuid, date) to authenticated, service_role;
grant execute on function public.price_list_summary(uuid) to authenticated, service_role;
grant execute on function public.offer_season_prices(uuid, uuid) to authenticated, service_role;
grant execute on function public.apply_price_list_to_offer(uuid, uuid, boolean) to authenticated, service_role;
grant execute on function public.price_list_round(numeric, numeric) to authenticated, service_role;
grant execute on function public.price_list_duplicate(uuid, text, date, date, numeric, numeric) to authenticated, service_role;
grant execute on function public.price_list_fill_from_catalog(uuid, uuid, numeric, numeric) to authenticated, service_role;
