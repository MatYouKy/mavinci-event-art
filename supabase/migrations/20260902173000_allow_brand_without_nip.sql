ALTER TABLE public.my_companies
  ALTER COLUMN nip DROP NOT NULL;

UPDATE public.my_companies
SET nip = NULL
WHERE btrim(COALESCE(nip, '')) = '';

COMMENT ON COLUMN public.my_companies.nip IS
  'NIP podmiotu prawnego. Pole może być puste dla marki, która nie jest odrębnym podmiotem gospodarczym.';

NOTIFY pgrst, 'reload schema';
