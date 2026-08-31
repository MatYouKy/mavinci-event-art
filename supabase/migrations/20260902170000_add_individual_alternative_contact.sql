ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS alternative_contact_name text;

COMMENT ON COLUMN public.contacts.alternative_contact_name IS
  'Imię, nazwisko lub opis osoby dostępnej pod alternatywnym numerem kontaktowym zapisanym w contacts.mobile';

NOTIFY pgrst, 'reload schema';
