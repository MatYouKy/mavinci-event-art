BEGIN;

-- Additive only. A missing historical term must not be inferred as indefinite.
ALTER TABLE public.external_invoices
  ADD COLUMN IF NOT EXISTS contract_term text,
  ADD COLUMN IF NOT EXISTS contract_start_date date,
  ADD COLUMN IF NOT EXISTS contract_end_date date;

ALTER TABLE public.personnel_contracts
  ADD COLUMN IF NOT EXISTS contract_term text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.external_invoices'::regclass AND conname = 'external_invoices_contract_period_check') THEN
    ALTER TABLE public.external_invoices ADD CONSTRAINT external_invoices_contract_period_check CHECK (
      (contract_term IS NULL AND contract_start_date IS NULL AND contract_end_date IS NULL)
      OR (
        contract_term IS NOT NULL AND contract_term IN ('fixed', 'indefinite')
        AND document_kind IS NOT NULL AND document_kind = 'contract'
        AND contract_start_date IS NOT NULL
        AND (contract_end_date IS NULL OR contract_end_date >= contract_start_date)
        AND (contract_term <> 'fixed' OR contract_end_date IS NOT NULL)
      )
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.personnel_contracts'::regclass AND conname = 'personnel_contracts_term_period_check') THEN
    ALTER TABLE public.personnel_contracts ADD CONSTRAINT personnel_contracts_term_period_check CHECK (
      contract_term IS NULL
      OR (
        contract_term IN ('fixed', 'indefinite')
        AND start_date IS NOT NULL
        AND (end_date IS NULL OR end_date >= start_date)
        AND (contract_term <> 'fixed' OR end_date IS NOT NULL)
        AND (status NOT IN ('completed', 'terminated') OR end_date IS NOT NULL)
      )
    );
  END IF;
END $$;

COMMENT ON COLUMN public.external_invoices.contract_term IS
  'fixed: only the assigned accounting month; indefinite: the same source document visible monthly during its validity. NULL: historical term not yet specified. Does not generate invoices, payments or recurring amounts.';
COMMENT ON COLUMN public.external_invoices.contract_start_date IS 'First day of contract validity; not the document issue date or payment due date.';
COMMENT ON COLUMN public.external_invoices.contract_end_date IS 'Inclusive last day of validity; NULL for an open indefinite contract. Can be a planned future termination date.';
COMMENT ON COLUMN public.personnel_contracts.contract_term IS
  'fixed: start month and actual recorded payments; indefinite: valid months through end_date inclusive and actual recorded payments. NULL preserves historical unclassified records. Does not generate payroll entries.';

NOTIFY pgrst, 'reload schema';
COMMIT;
