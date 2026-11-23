-- Oferta weselna, etap 3: produkt w kilku kategoriach eventów (konteksty sprzedaży) zamiast kopii produktu.
--
-- `offer_products.category_id` zostaje kategorią główną (nazwa kategorii na karcie, raporty, dotychczasowe filtry);
-- `extra_category_ids` — kategorie, w których produkt pokazuje się dodatkowo (katalog, kreator oferty, „Dodaj pozycję”,
-- cenniki i uzupełnianie cennika z katalogu). Jeden produkt = jedna cena, zdjęcia, sprzęt, obsada i strona PDF, więc np.
-- Fotolustro z kategorii „Dodatki” może być też w „Wesele” i „EVENT” bez osobnych kopii.
--
-- Wyzwalacz porządkuje listę: bez powtórzeń, bez kategorii głównej i bez identyfikatorów, których nie ma w
-- `event_categories` (kategorię usuniętą później filtry po prostu pomijają). Istniejące produkty dostają pustą listę.
-- Funkcja wyzwalacza czyta tylko identyfikatory i nazwy kategorii (security definer — niezależnie od RLS zapisującego).

alter table public.offer_products
  add column if not exists extra_category_ids uuid[] not null default '{}';

comment on column public.offer_products.extra_category_ids is
  'Dodatkowe kategorie eventów produktu (poza category_id) — produkt pokazuje się w nich w katalogu, kreatorze oferty i cennikach.';

create or replace function public.offer_products_extra_categories_normalize()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  new.extra_category_ids := coalesce((
    select array_agg(c.id order by c.name, c.id)
      from public.event_categories c
     where c.id = any(coalesce(new.extra_category_ids, '{}'::uuid[]))
       and c.id is distinct from new.category_id
  ), '{}'::uuid[]);
  return new;
end $$;

drop trigger if exists offer_products_extra_categories on public.offer_products;
create trigger offer_products_extra_categories
  before insert or update of extra_category_ids, category_id on public.offer_products
  for each row execute function public.offer_products_extra_categories_normalize();

create index if not exists offer_products_extra_category_ids_idx on public.offer_products using gin (extra_category_ids);

-- „Uzupełnij z katalogu” w cennikach: wybrana kategoria obejmuje też produkty, które mają ją jako dodatkową.
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
       and (p_category_id is null or p.category_id = p_category_id or p_category_id = any(p.extra_category_ids))
    union all
    select p.id, v.id, v.price_net
      from public.offer_products p
      join public.offer_product_variants v on v.product_id = p.id and v.is_active
     where p.is_active
       and p.configuration_schema is null
       and (p_category_id is null or p.category_id = p_category_id or p_category_id = any(p.extra_category_ids))
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

revoke all on function public.offer_products_extra_categories_normalize() from public, anon, authenticated;
revoke all on function public.price_list_fill_from_catalog(uuid, uuid, numeric, numeric) from public, anon;
grant execute on function public.price_list_fill_from_catalog(uuid, uuid, numeric, numeric) to authenticated, service_role;
