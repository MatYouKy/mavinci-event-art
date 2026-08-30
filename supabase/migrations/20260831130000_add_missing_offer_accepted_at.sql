-- Some installations were created without the acceptance timestamp from the
-- original offers extension migration. Variant-aware reservation records it.

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz;

COMMENT ON COLUMN public.offers.accepted_at IS
  'Moment zaakceptowania oferty i zatwierdzenia jej rezerwacji.';

