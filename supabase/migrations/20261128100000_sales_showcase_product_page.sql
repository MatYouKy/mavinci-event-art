-- Prezentacje: przełącznik „Pokazuj na stronie produktu dla klienta” w karcie.
--
-- Aktywna karta prezentacji powiązana z produktem pokazuje się też na publicznej stronie produktu `/produkty/[id]`
-- (sekcja „Zobacz w praktyce” — `src/lib/showcase/showcaseProductPage.server.ts`). Przełącznik w edytorze karty (CRM i Mac)
-- pozwala zostawić kartę tylko na spotkaniach. Domyślnie włączony — dotychczasowe karty pokazują się jak przed zmianą.
-- Zmiana przełącznika podnosi wersję karty (wyzwalacz `sales_showcase_guard` — jak każda zmiana treści).
-- Serwer czyta kolumnę tylko wtedy, gdy istnieje (bez tej migracji przełącznika nie ma, a strona produktu pokazuje aktywne karty).

alter table public.sales_showcase_items
  add column if not exists show_on_product_page boolean not null default true;

comment on column public.sales_showcase_items.show_on_product_page is
  'Karta pokazuje się też na stronie produktu dla klienta (/produkty/[id]) każdego powiązanego produktu — gdy aktywna i w aktywnym dziale.';
