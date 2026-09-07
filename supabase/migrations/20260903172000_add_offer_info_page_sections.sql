ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS info_page_sections jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.offers.info_page_sections IS
  'Trzy dodatkowe, edytowalne sekcje strony Informacje i warunki w PDF oferty.';
