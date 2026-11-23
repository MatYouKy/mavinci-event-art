-- Oferta weselna, etap 2: wycena „WASZA WYCENA” i kolory marki w szablonie ofert wesel.
--
-- Kategoria szablonu ofert przypisana do kategorii eventu „Wesele” (dziś Wesela-PDF) dostaje w `design_config`:
--   pricing_style = 'wedding'  — zamiast tabeli kalkulacji strona „WASZA WYCENA”: pozycje oferty z kwotami, rabat i VAT
--                                w podsumowaniu, razem do zapłaty, zadatek z pozostałą kwotą i warunki
--                                (`src/lib/offer-pdf/weddingPricing.ts`);
--   brand_colors = true        — strony generowane w kolorach z księgi znaku marki wydarzenia (Event Rulers);
--   deposit_percent = 30       — zadatek w % kwoty do zapłaty (tylko gdy kategoria go jeszcze nie ma);
--   wedding_terms_text         — warunki pod wyceną, wiersz = warunek (tylko gdy kategoria ich jeszcze nie ma).
-- Wszystko można zmienić w Oferty → Szablony → kategoria (CRM i Mac). Same dane, bez zmian schematu; ponowne
-- uruchomienie niczego nie psuje (zadatek i warunki zapisane w edytorze zostają).

update public.offer_template_categories as c
set design_config = jsonb_build_object(
      'deposit_percent', 30,
      'wedding_terms_text', E'Ubezpieczenie OC\nDojazd: 50 km gratis, dalej 1 zł/km\nPokój dla zespołu'
    )
    || coalesce(c.design_config, '{}'::jsonb)
    || jsonb_build_object('pricing_style', 'wedding', 'brand_colors', true)
where c.id in (
  select ec.default_offer_template_category_id
  from public.event_categories as ec
  where ec.default_offer_template_category_id is not null
    and lower(ec.name) like 'wesel%'
);
