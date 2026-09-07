-- Zweryfikowany snapshot wymagań konkretnej oferty.
-- Generator nadal wylicza bazę z szablonu i produktów, a zapisane pozycje
-- przechowują decyzje użytkownika, ręczne dopiski oraz wyłączenia.

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS offer_requirements jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.offers
  DROP CONSTRAINT IF EXISTS offers_offer_requirements_is_array;

ALTER TABLE public.offers
  ADD CONSTRAINT offers_offer_requirements_is_array
  CHECK (jsonb_typeof(offer_requirements) = 'array');

COMMENT ON COLUMN public.offers.offer_requirements IS
  'Zweryfikowane wymagania oferty: key, category, title, description, sources, origin, included i priority. Scalane z aktualnym szablonem oraz wymaganiami produktów.';
