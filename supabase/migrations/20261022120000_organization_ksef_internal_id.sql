BEGIN;
SET LOCAL lock_timeout='3s';
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS ksef_internal_id text;
COMMENT ON COLUMN public.organizations.ksef_internal_id IS 'Opcjonalny numer identyfikacji wewnętrznej odbiorcy w KSeF.';
NOTIFY pgrst, 'reload schema';
COMMIT;
