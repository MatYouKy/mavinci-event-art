-- Trzy konfigurowalne założenia biznesowe prezentowane na stronie oferty.
-- Pole tekstowe event_assumptions pozostaje czytelnym snapshotem dla starszych
-- integracji, wyszukiwania i ofert utworzonych przed tą zmianą.

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS event_assumption_items jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.offers
  DROP CONSTRAINT IF EXISTS offers_event_assumption_items_check;

ALTER TABLE public.offers
  ADD CONSTRAINT offers_event_assumption_items_check
  CHECK (
    jsonb_typeof(event_assumption_items) = 'array'
    AND jsonb_array_length(event_assumption_items) <= 3
  );

COMMENT ON COLUMN public.offers.event_assumption_items IS
  'Maksymalnie trzy wybrane założenia biznesowe oferty: key, label i value.';
