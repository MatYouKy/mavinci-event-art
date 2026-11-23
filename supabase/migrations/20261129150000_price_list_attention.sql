-- Oferta weselna, etap 4: „Do sprawdzenia” w Oferty → Cenniki.
--
-- `price_list_attention()` — lista dla biura (z uprawnieniami wywołującego, RLS):
--   offers  — oferty w toku (szkic, wysłana; bez ofert sprzedawców), których cennik różni się od cennika sezonu ich terminu
--             (`different`: np. event przeniesiony na inny rok albo aktywowano nowy cennik) oraz szkice bez cennika z terminem
--             od dziś, dla których sezon ma już aktywny cennik (`unlinked`). Ceny w ofercie nie zmieniają się same — decyzję
--             („Przelicz według cennika” z podglądem różnic) podejmuje się w ofercie;
--   missing — lata, w których marka korzystająca z cenników ma przyszłe eventy (do 30 miesięcy), a nie ma aktywnego cennika.
-- Bez zmian danych.

create or replace function public.price_list_attention()
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_offers jsonb;
  v_missing jsonb;
  v_today date := (now() at time zone 'Europe/Warsaw')::date;
begin
  with candidates as (
    select o.id, o.offer_number, o.status, o.title, o.price_list_id
      from public.offers o
     where o.status in ('draft', 'sent')
       and coalesce(o.sales_channel, '') <> 'seller_portal'
       and (o.price_list_id is not null or o.status = 'draft')
  ), priced as (
    select c.*, x.company_id, x.price_date, x.date_source,
           case when x.company_id is not null then public.season_price_list_id(x.company_id, x.price_date) end as season_id
      from candidates c
      cross join lateral public.offer_price_context(null, c.id) x
  ), flagged as (
    select p.*,
           case when p.price_list_id is not null then 'different' else 'unlinked' end as kind
      from priced p
     where p.company_id is not null
       and ((p.price_list_id is not null and p.season_id is distinct from p.price_list_id)
         or (p.price_list_id is null and p.season_id is not null and p.price_date >= v_today and p.date_source <> 'today'))
     order by p.price_date, p.offer_number
     limit 200
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'offer_id', f.id,
           'offer_number', f.offer_number,
           'title', f.title,
           'status', f.status,
           'kind', f.kind,
           'date', f.price_date,
           'date_source', f.date_source,
           'price_list', public.price_list_summary(f.price_list_id),
           'season', public.price_list_summary(f.season_id)
         ) order by f.price_date, f.offer_number), '[]'::jsonb)
    into v_offers
    from flagged f;

  with users as (
    select distinct p.my_company_id as company_id from public.price_lists p
  ), dates as (
    select coalesce(e.my_company_id, c.default_my_company_id, parent.default_my_company_id) as company_id,
           (e.event_date at time zone 'Europe/Warsaw')::date as day
      from public.events e
      left join public.event_categories c on c.id = e.category_id
      left join public.event_categories parent on parent.id = c.parent_category_id
     where e.event_date >= now()
       and e.event_date < now() + interval '30 months'
  ), gaps as (
    select d.company_id, extract(year from d.day)::int as year, count(*)::int as events
      from dates d
     where d.company_id in (select company_id from users)
       and public.season_price_list_id(d.company_id, d.day) is null
     group by d.company_id, extract(year from d.day)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'company_id', g.company_id,
           'company_name', (select m.name from public.my_companies m where m.id = g.company_id),
           'year', g.year,
           'events', g.events
         ) order by g.year, g.company_id), '[]'::jsonb)
    into v_missing
    from gaps g;

  return jsonb_build_object('offers', v_offers, 'missing', v_missing);
end $$;

revoke all on function public.price_list_attention() from public, anon;
grant execute on function public.price_list_attention() to authenticated, service_role;
