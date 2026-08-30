-- Uporządkowane dane zasilające sekcję „Założenia wydarzenia” w ofercie PDF.
-- Zapytanie przechowuje je w inquiry_details, a oferta zachowuje własny snapshot,
-- dzięki czemu późniejsza zmiana zapytania nie zmienia już przygotowanej oferty.

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS event_assumptions text,
  ADD COLUMN IF NOT EXISTS event_goal text;

COMMENT ON COLUMN public.offers.event_assumptions IS
  'Założenia wydarzenia widoczne dla klienta i używane przy generowaniu oferty PDF.';

COMMENT ON COLUMN public.offers.event_goal IS
  'Cel wydarzenia widoczny dla klienta i używany przy generowaniu oferty PDF.';

UPDATE public.offers AS offer
SET
  event_assumptions = COALESCE(
    NULLIF(btrim(offer.event_assumptions), ''),
    NULLIF(btrim(inquiry.inquiry_details ->> 'event_assumptions'), ''),
    NULLIF(btrim(inquiry.inquiry_details ->> 'scope'), '')
  ),
  event_goal = COALESCE(
    NULLIF(btrim(offer.event_goal), ''),
    NULLIF(btrim(inquiry.inquiry_details ->> 'event_goal'), '')
  )
FROM public.tasks AS inquiry
WHERE inquiry.id = offer.inquiry_id
  AND (
    offer.event_assumptions IS NULL
    OR btrim(offer.event_assumptions) = ''
    OR offer.event_goal IS NULL
    OR btrim(offer.event_goal) = ''
  );
