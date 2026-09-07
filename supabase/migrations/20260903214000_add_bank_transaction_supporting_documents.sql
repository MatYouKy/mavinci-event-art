/*
  Dokumenty i szczegolowe klasyfikacje dla operacji bankowych, ktorych
  podstawa nie zawsze jest faktura (VAT, PIT, ZUS, listy plac, prowizje).
*/

BEGIN;

ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS accounting_subtype text;

ALTER TABLE public.bank_transactions
  DROP CONSTRAINT IF EXISTS bank_transactions_accounting_subtype_check;
ALTER TABLE public.bank_transactions
  ADD CONSTRAINT bank_transactions_accounting_subtype_check
  CHECK (
    accounting_subtype IS NULL OR accounting_subtype IN (
      'automatic_vat_transfer',
      'vat7_payment',
      'pit4_payment',
      'zus_payment',
      'payroll_payment',
      'bank_fee',
      'own_transfer',
      'cash_settlement',
      'supplier_invoice_missing',
      'other'
    )
  );

COMMENT ON COLUMN public.bank_transactions.accounting_subtype IS
  'Szczegolowy typ recznego wyjasnienia transakcji bankowej.';

CREATE TABLE IF NOT EXISTS public.bank_transaction_supporting_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_transaction_id uuid NOT NULL
    REFERENCES public.bank_transactions(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  title text NOT NULL,
  document_date date,
  amount numeric(14,2),
  currency text NOT NULL DEFAULT 'PLN',
  storage_path text NOT NULL UNIQUE,
  original_file_name text NOT NULL,
  mime_type text,
  file_size bigint,
  notes text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_transaction_supporting_documents_type_check CHECK (
    document_type IN (
      'payroll_list',
      'vat7_declaration',
      'pit4_declaration',
      'zus_declaration',
      'bank_confirmation',
      'other'
    )
  ),
  CONSTRAINT bank_transaction_supporting_documents_amount_check CHECK (
    amount IS NULL OR amount >= 0
  )
);

CREATE INDEX IF NOT EXISTS bank_transaction_supporting_documents_transaction_idx
  ON public.bank_transaction_supporting_documents(bank_transaction_id);

ALTER TABLE public.bank_transaction_supporting_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bank_transaction_supporting_documents_read
  ON public.bank_transaction_supporting_documents;
CREATE POLICY bank_transaction_supporting_documents_read
  ON public.bank_transaction_supporting_documents
  FOR SELECT TO authenticated
  USING (
    public.finance_can_view()
    AND EXISTS (
      SELECT 1
      FROM public.bank_transactions bt
      JOIN public.bank_statements bs ON bs.id = bt.statement_id
      WHERE bt.id = bank_transaction_id
        AND public.finance_company_visible(bs.my_company_id)
    )
  );

DROP POLICY IF EXISTS bank_transaction_supporting_documents_manage
  ON public.bank_transaction_supporting_documents;
CREATE POLICY bank_transaction_supporting_documents_manage
  ON public.bank_transaction_supporting_documents
  FOR ALL TO authenticated
  USING (
    public.finance_can_manage()
    AND EXISTS (
      SELECT 1
      FROM public.bank_transactions bt
      JOIN public.bank_statements bs ON bs.id = bt.statement_id
      WHERE bt.id = bank_transaction_id
        AND public.finance_company_visible(bs.my_company_id)
    )
  )
  WITH CHECK (
    public.finance_can_manage()
    AND EXISTS (
      SELECT 1
      FROM public.bank_transactions bt
      JOIN public.bank_statements bs ON bs.id = bt.statement_id
      WHERE bt.id = bank_transaction_id
        AND public.finance_company_visible(bs.my_company_id)
    )
  );

REVOKE ALL ON public.bank_transaction_supporting_documents FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.bank_transaction_supporting_documents TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'bank-supporting-documents',
  'bank-supporting-documents',
  false,
  15728640,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Sciezka ma postac: company_id/transaction_id/nazwa-pliku. Polityki
-- sprawdzaja oba identyfikatory bez rzutowania danych podanych przez klienta.
DROP POLICY IF EXISTS bank_supporting_documents_storage_read ON storage.objects;
CREATE POLICY bank_supporting_documents_storage_read
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'bank-supporting-documents'
    AND public.finance_can_view()
    AND EXISTS (
      SELECT 1
      FROM public.bank_transactions bt
      JOIN public.bank_statements bs ON bs.id = bt.statement_id
      WHERE bt.id::text = (storage.foldername(name))[2]
        AND bs.my_company_id::text = (storage.foldername(name))[1]
        AND public.finance_company_visible(bs.my_company_id)
    )
  );

DROP POLICY IF EXISTS bank_supporting_documents_storage_insert ON storage.objects;
CREATE POLICY bank_supporting_documents_storage_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'bank-supporting-documents'
    AND public.finance_can_manage()
    AND EXISTS (
      SELECT 1
      FROM public.bank_transactions bt
      JOIN public.bank_statements bs ON bs.id = bt.statement_id
      WHERE bt.id::text = (storage.foldername(name))[2]
        AND bs.my_company_id::text = (storage.foldername(name))[1]
        AND public.finance_company_visible(bs.my_company_id)
    )
  );

DROP POLICY IF EXISTS bank_supporting_documents_storage_delete ON storage.objects;
CREATE POLICY bank_supporting_documents_storage_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'bank-supporting-documents'
    AND public.finance_can_manage()
    AND EXISTS (
      SELECT 1
      FROM public.bank_transactions bt
      JOIN public.bank_statements bs ON bs.id = bt.statement_id
      WHERE bt.id::text = (storage.foldername(name))[2]
        AND bs.my_company_id::text = (storage.foldername(name))[1]
        AND public.finance_company_visible(bs.my_company_id)
    )
  );

COMMENT ON TABLE public.bank_transaction_supporting_documents IS
  'Dokumenty zrodlowe dolaczone do operacji bez faktury, np. lista plac, VAT-7, PIT-4R lub deklaracja ZUS.';

CREATE OR REPLACE FUNCTION public.mark_bank_ai_report_stale_from_transaction_explanation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id uuid;
  v_month smallint;
  v_year integer;
BEGIN
  SELECT bs.my_company_id, bs.statement_month, bs.statement_year
  INTO v_company_id, v_month, v_year
  FROM public.bank_statements bs
  WHERE bs.id = NEW.statement_id;

  UPDATE public.bank_ai_reconciliation_reports report
  SET is_stale = true
  WHERE report.is_stale = false
    AND report.statement_month = v_month
    AND report.statement_year = v_year
    AND (report.my_company_id IS NULL OR report.my_company_id = v_company_id);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mark_bank_ai_report_stale_from_transaction_explanation
  ON public.bank_transactions;
CREATE TRIGGER mark_bank_ai_report_stale_from_transaction_explanation
AFTER UPDATE OF accounting_category, accounting_subtype, accounting_note, accounting_review_status
ON public.bank_transactions
FOR EACH ROW
WHEN (
  OLD.accounting_category IS DISTINCT FROM NEW.accounting_category
  OR OLD.accounting_subtype IS DISTINCT FROM NEW.accounting_subtype
  OR OLD.accounting_note IS DISTINCT FROM NEW.accounting_note
  OR OLD.accounting_review_status IS DISTINCT FROM NEW.accounting_review_status
)
EXECUTE FUNCTION public.mark_bank_ai_report_stale_from_transaction_explanation();

REVOKE ALL ON FUNCTION public.mark_bank_ai_report_stale_from_transaction_explanation() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';

COMMIT;
