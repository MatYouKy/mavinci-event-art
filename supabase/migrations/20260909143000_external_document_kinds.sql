BEGIN;

-- Preserve the existing IDs, attachments and bank allocations. This is a subtype,
-- not a separate invoice or a second accounting entry for the same document.
ALTER TABLE public.external_invoices
  ADD COLUMN IF NOT EXISTS document_kind text NOT NULL DEFAULT 'invoice';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.external_invoices'::regclass
      AND conname = 'external_invoices_document_kind_check'
  ) THEN
    ALTER TABLE public.external_invoices
      ADD CONSTRAINT external_invoices_document_kind_check
      CHECK (document_kind IN (
        'invoice', 'receipt', 'credit_note', 'insurance_policy',
        'contract', 'debit_note', 'other'
      ));
  END IF;
END;
$$;

COMMENT ON COLUMN public.external_invoices.document_kind IS
  'Rodzaj dokumentu spoza KSeF. Polisa: invoice_number przechowuje numer polisy, seller_name ubezpieczyciela, amount_gross całkowitą składkę (nie sumę ubezpieczenia). Sam rodzaj nie stanowi potwierdzenia kosztu podatkowego ani opłacenia.';

NOTIFY pgrst, 'reload schema';
COMMIT;
