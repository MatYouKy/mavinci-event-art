-- Indywidualne zmiany klauzul obowiązujące wyłącznie w ramach jednej umowy
-- wydarzenia. Bazowe klauzule produktów i oferty pozostają niezmienione.
ALTER TABLE public.events
ADD COLUMN IF NOT EXISTS contract_clause_overrides jsonb NOT NULL
DEFAULT '{"version":1,"overrides":{},"custom":[]}'::jsonb;

COMMENT ON COLUMN public.events.contract_clause_overrides IS
  'Edycje, wyłączenia i dodatkowe klauzule umowy zapisane wyłącznie dla wydarzenia.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'events_contract_clause_overrides_is_object'
      AND conrelid = 'public.events'::regclass
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_contract_clause_overrides_is_object
      CHECK (jsonb_typeof(contract_clause_overrides) = 'object');
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';
