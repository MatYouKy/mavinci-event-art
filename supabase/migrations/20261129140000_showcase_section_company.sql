-- Oferta weselna, etap 3: marka działu Prezentacji i termin z zapytania w cenach sezonu.
--
-- 1. `sales_showcase_sections.my_company_id` — marka działu (np. Wesela → Event Rulers). Oferta ze spotkania z kart tego działu
--    dostaje tę markę (PDF w barwach marki) i ceny z jej aktywnego cennika sezonu dla terminu z rozmowy (bez terminu — dziś);
--    oferta pamięta cennik (`offers.price_list_id`), pozycje — ceny wariantów (gwarancja ceny jak w kreatorze ofert).
-- 2. `offer_price_context` — data do wyboru sezonu: event → data w ofercie → termin z zapytania (`inquiry_details.termin`,
--    `YYYY-MM-DD…`) → dziś. Oferty z zapytania bez eventu (w tym oferty ze spotkania) liczą się więc z cennika roku wesela,
--    a nie z bieżącego roku. Termin z zapytania jest terminem eventu (`date_source` = 'offer' — „data eventu” w opisach).

alter table public.sales_showcase_sections
  add column if not exists my_company_id uuid references public.my_companies(id) on delete set null;

comment on column public.sales_showcase_sections.my_company_id is
  'Marka działu Prezentacji: oferta ze spotkania z kart działu dostaje tę markę i ceny z jej cennika sezonu.';

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
  v_inquiry_id uuid;
  v_inquiry_date text;
  v_event_company uuid;
  v_event_date timestamptz;
  v_category_company uuid;
begin
  if p_offer_id is not null then
    select o.event_id, o.my_company_id, o.event_date, o.price_list_id, o.sales_channel, o.status, o.inquiry_id
      into v_event_id, v_offer_company, v_offer_date, offer_price_list_id, sales_channel, offer_status, v_inquiry_id
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

  if v_event_date is null and v_offer_date is null and v_inquiry_id is not null then
    select substring(t.inquiry_details ->> 'termin' from '^\d{4}-\d{2}-\d{2}')
      into v_inquiry_date
      from public.tasks t
     where t.id = v_inquiry_id;
  end if;

  company_id := coalesce(v_offer_company, v_event_company, v_category_company);
  if v_event_date is not null then
    price_date := (v_event_date at time zone 'Europe/Warsaw')::date;
    date_source := 'event';
  elsif v_offer_date is not null then
    price_date := (v_offer_date at time zone 'Europe/Warsaw')::date;
    date_source := 'offer';
  elsif v_inquiry_date is not null then
    -- Nieprawidłowa data w zapytaniu (np. 2027-02-31) — jak brak terminu.
    begin
      price_date := v_inquiry_date::date;
      date_source := 'offer';
    exception when others then
      price_date := null;
    end;
  end if;
  if price_date is null then
    price_date := (now() at time zone 'Europe/Warsaw')::date;
    date_source := 'today';
  end if;
  return next;
end $$;

revoke all on function public.offer_price_context(uuid, uuid) from public, anon;
grant execute on function public.offer_price_context(uuid, uuid) to authenticated, service_role;
