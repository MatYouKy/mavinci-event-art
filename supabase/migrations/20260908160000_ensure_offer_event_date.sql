-- Termin oferty bez zmiany dat powiązanego wydarzenia lub zapytania.
ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS event_date timestamptz;

COMMENT ON COLUMN public.offers.event_date IS
  'Termin zapisany w ofercie, używany również w PDF, gdy powiązane wydarzenie nie ma własnego terminu.';

NOTIFY pgrst, 'reload schema';
