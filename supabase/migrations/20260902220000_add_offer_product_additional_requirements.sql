/*
  # Opisowe wymagania organizacyjne produktów w ofercie

  Dotychczasowe offer_requirements pozostaje prostą listą warunków technicznych.
  Nowe pole przechowuje elastyczne, opisowe wymagania, np. zakwaterowanie,
  garderobę, catering albo warunki logistyczne. Generator PDF agreguje oba źródła.
*/

ALTER TABLE public.offer_products
  ADD COLUMN IF NOT EXISTS offer_additional_requirements jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.offer_products
  DROP CONSTRAINT IF EXISTS offer_products_additional_requirements_is_array;

ALTER TABLE public.offer_products
  ADD CONSTRAINT offer_products_additional_requirements_is_array
  CHECK (jsonb_typeof(offer_additional_requirements) = 'array');

COMMENT ON COLUMN public.offer_products.offer_additional_requirements IS
  'Opisowe wymagania organizacyjne produktu. Tablica obiektów: id, category, title, description; agregowana na osobnej stronie oferty PDF.';
