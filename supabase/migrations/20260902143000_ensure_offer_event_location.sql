-- Oferta może powstać bez wydarzenia (np. bezpośrednio z zapytania), dlatego
-- przechowuje własny snapshot miejsca drukowany na okładce PDF.
ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS event_location text;

COMMENT ON COLUMN public.offers.event_location IS
  'Miejsce realizacji drukowane na okładce oferty; może pochodzić z wydarzenia lub zapytania.';

UPDATE public.offers AS offer
SET event_location = NULLIF(btrim(inquiry.inquiry_details ->> 'location_text'), '')
FROM public.tasks AS inquiry
WHERE offer.inquiry_id = inquiry.id
  AND NULLIF(btrim(offer.event_location), '') IS NULL
  AND NULLIF(btrim(inquiry.inquiry_details ->> 'location_text'), '') IS NOT NULL;
