-- Oferta weselna, etap 3: broszura z cennikiem sezonu.
--
-- Broszura to wszystkie pozycje, które możemy zaproponować („Oferta weselna 2027” do rozsyłki), więc może mieć stronę
-- „Cennik”: wybrany cennik sezonowy (`price_list_id`) daje ceny wszystkich widocznych stron usług — wariant w jednym wierszu,
-- bez ceny w cenniku cena z katalogu (`src/lib/brochures/brochurePriceList.ts`). Strona trafia do PDF przed zakończeniem;
-- zapisany PDF trzyma ceny z chwili generowania (historia wersji). Usunięcie cennika zostawia broszurę bez strony cennika.

alter table public.sales_brochures
  add column if not exists price_list_id uuid references public.price_lists(id) on delete set null;

comment on column public.sales_brochures.price_list_id is
  'Cennik sezonowy strony „Cennik” w PDF broszury (wszystkie widoczne usługi z cenami); null — bez strony cennika.';

create index if not exists sales_brochures_price_list_id_idx on public.sales_brochures (price_list_id) where price_list_id is not null;
