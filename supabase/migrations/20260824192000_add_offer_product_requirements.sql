/*
  # Wymagania produktu prezentowane w ofercie

  Lista pozostaje zatwierdzoną daną katalogową CRM. Generator PDF wyłącznie ją
  odczytuje i nie dopowiada wymagań technicznych samodzielnie.
*/

ALTER TABLE public.offer_products
  ADD COLUMN IF NOT EXISTS offer_requirements jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.offer_products
  DROP CONSTRAINT IF EXISTS offer_products_offer_requirements_is_array;

ALTER TABLE public.offer_products
  ADD CONSTRAINT offer_products_offer_requirements_is_array
  CHECK (jsonb_typeof(offer_requirements) = 'array');

COMMENT ON COLUMN public.offer_products.offer_requirements IS
  'Zatwierdzona lista wymagań po stronie klienta lub obiektu, prezentowana w ofercie PDF.';
