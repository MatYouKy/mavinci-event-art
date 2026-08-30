-- Oferta biznesowa może wskazywać jednocześnie organizację i wybraną osobę
-- kontaktową. organization_id określa kontrahenta, a contact_id kontakt właściwy
-- dla tej konkretnej oferty. Dzięki temu nie zmieniamy głównego kontaktu firmy.

ALTER TABLE public.offers
  DROP CONSTRAINT IF EXISTS offers_client_check;

ALTER TABLE public.offers
  ADD CONSTRAINT offers_client_check CHECK (
    (
      client_type = 'business'
      AND organization_id IS NOT NULL
    )
    OR
    (
      client_type = 'individual'
      AND contact_id IS NOT NULL
      AND organization_id IS NULL
    )
    OR
    (
      client_type IS NULL
      AND organization_id IS NULL
      AND contact_id IS NULL
    )
  );

COMMENT ON COLUMN public.offers.contact_id IS
  'Klient indywidualny albo osoba kontaktowa wybrana dla konkretnej oferty biznesowej.';

-- Dla ofert utworzonych z zapytań najważniejszy jest kontakt wskazany w źródłowym
-- zapytaniu, ponieważ to z nim prowadzona była rozmowa sprzedażowa.
UPDATE public.offers AS offer
SET contact_id = inquiry.contact_id
FROM public.tasks AS inquiry
WHERE offer.inquiry_id = inquiry.id
  AND offer.client_type = 'business'
  AND offer.organization_id IS NOT NULL
  AND offer.contact_id IS NULL
  AND inquiry.contact_id IS NOT NULL;

-- Pozostałe starsze oferty firmowe dostają bezpieczny punkt startowy. Późniejszy
-- wybór w ofercie pozostaje niezależny od primary_contact_id organizacji.
UPDATE public.offers AS offer
SET contact_id = organization.primary_contact_id
FROM public.organizations AS organization
WHERE offer.organization_id = organization.id
  AND offer.client_type = 'business'
  AND offer.contact_id IS NULL
  AND organization.primary_contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_offers_contact_id
  ON public.offers(contact_id);
